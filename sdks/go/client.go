// Package jicek_wlyz 是 jicek-wlyz 网络验证 SaaS 系统的 Go 客户端 SDK
//
// 协议规范参考 docs/api/protocol.md：
//   - verify_rsa: 明文（下发 RSA 公钥 + ECDHE 会话密钥）
//   - auth/use/unbind/heartbeat: RSA 签名 + AES-256-CBC 加密
//   - check_update: Base64 编码
//
// 安全设计（SPEC §2.6.1）：
//   - 请求头 RSA-2048 签名（METHOD\nPATH\nTS\nNONCE\nBODY）
//   - 时间戳 5 分钟有效期，Nonce 32 位随机串
//   - AES-256-CBC 业务加密 + 响应解密
//   - ECDHE PFS 完美前向保密
//
// 依赖：Go 1.21+
package jicek_wlyz

import (
	"bytes"
	"crypto"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ec"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// ---------------------------------------------------------------------------
// 异常与配置
// ---------------------------------------------------------------------------

// WlyzError SDK 异常
type WlyzError struct {
	Code int         `json:"code"`
	Msg  string      `json:"msg"`
	Data interface{} `json:"data"`
}

func (e *WlyzError) Error() string {
	return fmt.Sprintf("[%d] %s", e.Code, e.Msg)
}

// ClientConfig 客户端配置
type ClientConfig struct {
	BaseURL             string // 服务端基础 URL
	AppKey              string // 应用 AppKey
	ClientRSAPrivateKey string // 客户端 RSA 私钥（PEM）
	ServerRSAPublicKey  string // 服务端 RSA 公钥（PEM，VerifyRSA 后填充）
	Timeout             int    // 超时（秒）
	// ECDHE 派生会话密钥（VerifyRSA 后填充）
	SessionKey []byte
}

// WlyzClient 主客户端
type WlyzClient struct {
	config  *ClientConfig
	apiBase string
	http    *http.Client
}

// NewClient 创建客户端
func NewClient(config *ClientConfig) *WlyzClient {
	timeout := config.Timeout
	if timeout <= 0 {
		timeout = 10
	}
	return &WlyzClient{
		config:  config,
		apiBase: strings.TrimRight(config.BaseURL, "/") + "/api/v1",
		http: &http.Client{
			Timeout: time.Duration(timeout) * time.Second,
		},
	}
}

// ---------------------------------------------------------------------------
// 1. VerifyRSA - 获取服务端 RSA 公钥 + ECDHE 会话密钥协商
// ---------------------------------------------------------------------------

// VerifyRsaResponse verify_rsa 响应
type VerifyRsaResponse struct {
	ServerPublicKey     string `json:"server_public_key"`
	EcdhePublicKey      string `json:"ecdhe_public_key"`
	EncryptedSessionKey string `json:"encrypted_session_key"`
	CryptoMode          string `json:"crypto_mode"`
}

// VerifyRSA 获取服务端 RSA 公钥并完成 ECDHE 会话密钥协商
func (c *WlyzClient) VerifyRSA() (*VerifyRsaResponse, error) {
	// 客户端 ECDHE 临时密钥对（P-256）
	clientPriv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("生成 ECDHE 密钥对失败: %w", err)
	}
	clientPubDer, err := x509.MarshalPKIXPublicKey(&clientPriv.PublicKey)
	if err != nil {
		return nil, err
	}
	clientPubPem := string(pem.EncodeToMemory(&pem.Block{
		Type:  "PUBLIC KEY",
		Bytes: clientPubDer,
	}))

	bodyObj, _ := json.Marshal(map[string]string{
		"app_key":            c.config.AppKey,
		"client_public_key":  clientPubPem,
	})

	resp, err := c.httpPost("/verify_rsa", string(bodyObj), nil)
	if err != nil {
		return nil, err
	}
	data, err := c.checkResponse(resp)
	if err != nil {
		return nil, err
	}

	serverPubKey := data["server_public_key"].(string)
	c.config.ServerRSAPublicKey = serverPubKey

	// 解析服务端 ECDHE 公钥
	ecdhPemBlock, _ := pem.Decode([]byte(data["ecdhe_public_key"].(string)))
	if ecdhPemBlock == nil {
		return nil, errors.New("ECDHE 公钥 PEM 解析失败")
	}
	serverPubAny, err := x509.ParsePKIXPublicKey(ecdhPemBlock.Bytes)
	if err != nil {
		return nil, err
	}
	serverEcdhPub, ok := serverPubAny.(*ecdsa.PublicKey)
	if !ok {
		return nil, errors.New("ECDHE 公钥类型错误")
	}

	// ECDH 计算共享密钥 → SHA-256 → AES-256
	sharedX, _ := serverEcdhPub.Curve.ScalarMult(serverEcdhPub.X, serverEcdhPub.Y,
		clientPriv.D.Bytes())
	sharedSecret := sharedX.Bytes()
	hash := sha256.Sum256(sharedSecret)
	c.config.SessionKey = hash[:]

	return &VerifyRsaResponse{
		ServerPublicKey:     serverPubKey,
		EcdhePublicKey:      data["ecdhe_public_key"].(string),
		EncryptedSessionKey: data["encrypted_session_key"].(string),
		CryptoMode:          data["crypto_mode"].(string),
	}, nil
}

// ---------------------------------------------------------------------------
// 2-4, 6. 加密 action（auth/use/unbind/heartbeat）
// ---------------------------------------------------------------------------

// Auth 验证卡密并激活设备
func (c *WlyzClient) Auth(cardCode, machineCode, deviceName string) (map[string]interface{}, error) {
	return c.encryptedAction("/auth", map[string]string{
		"card_code":    cardCode,
		"machine_code": machineCode,
		"device_name":  deviceName,
	})
}

// Use 次数卡扣减
func (c *WlyzClient) Use(deviceID, cardCode string) (map[string]interface{}, error) {
	return c.encryptedAction("/use", map[string]string{
		"device_id": deviceID,
		"card_code": cardCode,
	})
}

// Unbind 解绑设备
func (c *WlyzClient) Unbind(deviceID string) (map[string]interface{}, error) {
	return c.encryptedAction("/unbind", map[string]string{
		"device_id": deviceID,
	})
}

// Heartbeat 心跳保活
func (c *WlyzClient) Heartbeat(deviceID, machineCode string) (map[string]interface{}, error) {
	return c.encryptedAction("/heartbeat", map[string]string{
		"device_id":    deviceID,
		"machine_code": machineCode,
	})
}

// ---------------------------------------------------------------------------
// 5. CheckUpdate - 检查更新和云配置
// ---------------------------------------------------------------------------

// CheckUpdate 检查更新和云配置
func (c *WlyzClient) CheckUpdate() (map[string]interface{}, error) {
	if c.config.ServerRSAPublicKey == "" {
		return nil, &WlyzError{Code: 2003, Msg: "未获取服务端公钥，请先调用 VerifyRSA"}
	}
	ts := fmt.Sprintf("%d", time.Now().Unix())
	nonceB := make([]byte, 16)
	_, _ = rand.Read(nonceB)
	nonce := hex.EncodeToString(nonceB)
	body := ""
	path := "/api/v1/check_update"
	sig, err := c.sign("POST", path, ts, nonce, body)
	if err != nil {
		return nil, err
	}
	headers := c.buildHeaders(ts, nonce, sig)
	resp, err := c.httpPost("/check_update", body, headers)
	if err != nil {
		return nil, err
	}
	return c.checkResponse(resp)
}

// ---------------------------------------------------------------------------
// 内部：加密 action
// ---------------------------------------------------------------------------

func (c *WlyzClient) encryptedAction(path string, payload interface{}) (map[string]interface{}, error) {
	if len(c.config.SessionKey) == 0 || c.config.ServerRSAPublicKey == "" {
		return nil, &WlyzError{Code: 2003, Msg: "会话未建立，请先调用 VerifyRSA"}
	}

	plaintext, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	iv := make([]byte, 16)
	_, _ = rand.Read(iv)
	encrypted, err := c.aesEncrypt(c.config.SessionKey, iv, plaintext)
	if err != nil {
		return nil, err
	}

	bodyObj := map[string]string{
		"iv":   hex.EncodeToString(iv),
		"data": encrypted,
	}
	bodyBytes, _ := json.Marshal(bodyObj)
	body := string(bodyBytes)

	ts := fmt.Sprintf("%d", time.Now().Unix())
	nonceB := make([]byte, 16)
	_, _ = rand.Read(nonceB)
	nonce := hex.EncodeToString(nonceB)
	sig, err := c.sign("POST", "/api/v1"+path, ts, nonce, body)
	if err != nil {
		return nil, err
	}
	headers := c.buildHeaders(ts, nonce, sig)

	resp, err := c.httpPost(path, body, headers)
	if err != nil {
		return nil, err
	}

	// 响应解密
	if ivHex, ok := resp["iv"].(string); ok {
		if encData, ok := resp["data"].(string); ok {
			respIV, err := hex.DecodeString(ivHex)
			if err != nil {
				return nil, err
			}
			plain, err := c.aesDecrypt(c.config.SessionKey, respIV, encData)
			if err != nil {
				return nil, err
			}
			var decrypted map[string]interface{}
			if err := json.Unmarshal(plain, &decrypted); err != nil {
				return nil, err
			}
			resp = decrypted
		}
	}

	return c.checkResponse(resp)
}

func (c *WlyzClient) checkResponse(resp map[string]interface{}) (map[string]interface{}, error) {
	code, ok := resp["code"].(float64)
	if !ok {
		return nil, &WlyzError{Code: 9001, Msg: "响应缺少 code 字段"}
	}
	if int(code) != 0 {
		msg, _ := resp["msg"].(string)
		return nil, &WlyzError{Code: int(code), Msg: msg, Data: resp["data"]}
	}
	data, _ := resp["data"].(map[string]interface{})
	return data, nil
}

// ---------------------------------------------------------------------------
// 加密与签名
// ---------------------------------------------------------------------------

func (c *WlyzClient) sign(method, path, ts, nonce, body string) (string, error) {
	source := strings.Join([]string{method, path, ts, nonce, body}, "\n")
	block, _ := pem.Decode([]byte(c.config.ClientRSAPrivateKey))
	if block == nil {
		return "", errors.New("RSA 私钥 PEM 解析失败")
	}
	privAny, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		privAny, err = x509.ParsePKCS1PrivateKey(block.Bytes)
		if err != nil {
			return "", err
		}
	}
	rsaPriv, ok := privAny.(*rsa.PrivateKey)
	if !ok {
		return "", errors.New("私钥非 RSA 类型")
	}
	hash := sha256.Sum256([]byte(source))
	sig, err := rsa.SignPKCS1v15(rand.Reader, rsaPriv, crypto.SHA256, hash[:])
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(sig), nil
}

func (c *WlyzClient) buildHeaders(ts, nonce, signature string) map[string]string {
	return map[string]string{
		"X-App-Key":   c.config.AppKey,
		"X-Timestamp": ts,
		"X-Nonce":     nonce,
		"X-Signature": signature,
		"Content-Type": "application/json",
	}
}

func (c *WlyzClient) aesEncrypt(key, iv, plaintext []byte) (string, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	padding := 16 - len(plaintext)%16
	padded := append(plaintext, bytes.Repeat([]byte{byte(padding)}, padding)...)
	encrypted := make([]byte, len(padded))
	mode := cipher.NewCBCEncrypter(block, iv)
	mode.CryptBlocks(encrypted, padded)
	return base64.StdEncoding.EncodeToString(encrypted), nil
}

func (c *WlyzClient) aesDecrypt(key, iv []byte, encrypted string) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	raw, err := base64.StdEncoding.DecodeString(encrypted)
	if err != nil {
		return nil, err
	}
	decrypted := make([]byte, len(raw))
	mode := cipher.NewCBCDecrypter(block, iv)
	mode.CryptBlocks(decrypted, raw)
	if len(decrypted) == 0 {
		return decrypted, nil
	}
	padLen := int(decrypted[len(decrypted)-1])
	if padLen > 16 || padLen > len(decrypted) {
		return decrypted, nil
	}
	return decrypted[:len(decrypted)-padLen], nil
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

func (c *WlyzClient) httpPost(path, body string, headers map[string]string) (map[string]interface{}, error) {
	req, err := http.NewRequest("POST", c.apiBase+path, strings.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if headers != nil {
		for k, v := range headers {
			req.Header.Set(k, v)
		}
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, &WlyzError{Code: 9001, Msg: "网络错误: " + err.Error()}
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	var result map[string]interface{}
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, &WlyzError{Code: 9001, Msg: "响应非合法 JSON: " + string(raw[:min(len(raw), 200)])}
	}
	return result, nil
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
