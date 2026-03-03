const os = require('os');
const http = require('http');
const fs = require('fs');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const { exec, execSync } = require('child_process');

function ensureModule(name) {
    try {
        require.resolve(name);
    } catch (e) {
        console.log(`Module '${name}' not found. Installing...`);
        execSync(`npm install ${name}`, { stdio: 'inherit' });
    }
}
ensureModule('ws');
const { WebSocket, createWebSocketStream } = require('ws');

const NAME = process.env.NAME || os.hostname();
console.log("~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~");
console.log("甬哥Github项目  ：github.com/Hubdarkweb");
console.log("甬哥Blogger博客 ：darkwebforums.topnet7hackers.space");
console.log("甬哥YouTube频道 ：www.youtube.com/@topnet7hackersspace");
console.log("Nodejs真一键无交互Vless+Trojan代理脚本");
console.log("当前版本：25.6.9-Trojan");
console.log("~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~");

async function getVariableValue(variableName, defaultValue) {
    const envValue = process.env[variableName];
    if (envValue) return envValue;
    if (defaultValue) return defaultValue;
    let input = '';
    while (!input) {
        input = await ask(`请输入${variableName}: `);
        if (!input) console.log(`${variableName}不能为空，请重新输入!`);
    }
    return input;
}

function ask(question) {
    const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()); }));
}

// Trojan password hash verification
function verifyTrojanPassword(data, passwordHash) {
    if (data.length < 58) return false;
    const received = data.slice(0, 56).toString('hex');
    const crlf = data.slice(56, 58).toString('hex');
    return (received === passwordHash && crlf === '0d0a');
}

// Parse Trojan request after password verification
function parseTrojanRequest(data) {
    if (data.length < 58) return null;
    const crlfEnd = 58;
    let i = crlfEnd;
    
    // Read command (1 byte)
    const command = data[i];
    i += 1;
    
    // Read address type (1 byte)
    const ATYP = data[i];
    i += 1;
    
    let host = '';
    if (ATYP === 1) {
        // IPv4
        host = data.slice(i, i + 4).join('.');
        i += 4;
    } else if (ATYP === 3) {
        // Domain
        const domainLen = data[i];
        host = data.slice(i + 1, i + 1 + domainLen).toString();
        i += 1 + domainLen;
    } else if (ATYP === 4) {
        // IPv6
        const ipv6 = data.slice(i, i + 16);
        const parts = [];
        for (let j = 0; j < 16; j += 2) {
            parts.push((ipv6[j] << 8 | ipv6[j + 1]).toString(16));
        }
        host = parts.join(':');
        i += 16;
    }
    
    // Read port (2 bytes)
    const port = data.slice(i, i + 2).readUInt16BE(0);
    i += 2;
    
    return { host, port, remaining: data.slice(i) };
}

async function main() {
    const UUID = await getVariableValue('UUID', 'adfc1482-c28a-0765-7078-93fd14de1c63');
    console.log('你的UUID:', UUID);

    const TROJAN_PASS = await getVariableValue('TROJAN_PASS', 'trojan888');
    console.log('你的Trojan密码:', TROJAN_PASS);
    
    const TROJAN_HASH = crypto.createHash('sha224').update(TROJAN_PASS).digest('hex');
    console.log('Trojan密码SHA224:', TROJAN_HASH);

    const PORT = await getVariableValue('PORT', '443');
    console.log('你的端口:', PORT);

    const DOMAIN = await getVariableValue('DOMAIN', 'ying-gcp-test-676927566012.us-west1.run.app');
    console.log('你的域名:', DOMAIN);

    const httpServer = http.createServer((req, res) => {
        if (req.url === '/') {
            res.writeHead(502, { 'Content-Type': 'text/plain' });
            res.end('404 Not Found\n');
        } else if (req.url === `/${UUID}`) {
            let vlessURL, trojanURL;
            if (NAME.includes('server') || NAME.includes('hostypanel')) {
                vlessURL = `vless://${UUID}@${DOMAIN}:443?encryption=none&security=tls&sni=${DOMAIN}&fp=chrome&type=ws&host=${DOMAIN}&path=%2F#Vl-ws-tls-${NAME}`;
                trojanURL = `trojan://${TROJAN_PASS}@${DOMAIN}:443?sni=${DOMAIN}&fp=chrome&type=ws&host=${DOMAIN}&path=%2F#Tr-ws-tls-${NAME}`;
            } else {
                vlessURL = `vless://${UUID}@${DOMAIN}:443?encryption=none&security=tls&sni=${DOMAIN}&fp=chrome&type=ws&host=${DOMAIN}&path=%2F#Vl-ws-tls-${NAME}`;
                trojanURL = `trojan://${TROJAN_PASS}@${DOMAIN}:443?sni=${DOMAIN}&fp=chrome&type=ws&host=${DOMAIN}&path=%2F#Tr-ws-tls-${NAME}`;
            }
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end(`VLESS:\n${vlessURL}\n\nTrojan:\n${trojanURL}\n`);
        } else {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found\n');
        }
    });

    httpServer.listen(PORT, () => {
        console.log(`HTTP Server is running on port ${PORT}`);
    });

    const wss = new WebSocket.Server({ server: httpServer });
    const uuid = UUID.replace(/-/g, "");
    
    wss.on('connection', ws => {
        let protocolDetected = false;
        
        ws.once('message', async msg => {
            const buffer = Buffer.isBuffer(msg) ? msg : Buffer.from(msg);
            
            // Try VLESS first (check UUID at bytes 1-17)
            if (buffer.length >= 17) {
                const id = buffer.slice(1, 17);
                const isVless = id.every((v, i) => v == parseInt(uuid.substr(i * 2, 2), 16));
                
                if (isVless) {
                    protocolDetected = 'VLESS';
                    // VLESS handling (original code)
                    const VERSION = buffer[0];
                    let i = buffer.slice(17, 18).readUInt8() + 19;
                    const port = buffer.slice(i, i += 2).readUInt16BE(0);
                    const ATYP = buffer.slice(i, i += 1).readUInt8();
                    const host = ATYP == 1 ? buffer.slice(i, i += 4).join('.') :
                        (ATYP == 2 ? new TextDecoder().decode(buffer.slice(i + 1, i += 1 + buffer.slice(i, i + 1).readUInt8())) :
                            (ATYP == 3 ? buffer.slice(i, i += 16).reduce((s, b, i, a) => (i % 2 ? s.concat(a.slice(i - 1, i + 1)) : s), []).map(b => b.readUInt16BE(0).toString(16)).join(':') : ''));
                    ws.send(new Uint8Array([VERSION, 0]));
                    const duplex = createWebSocketStream(ws);
                    net.connect({ host, port }, function () {
                        this.write(buffer.slice(i));
                        duplex.on('error', () => { }).pipe(this).on('error', () => { }).pipe(duplex);
                    }).on('error', () => { });
                    console.log(`[VLESS] Connected: ${host}:${port}`);
                    return;
                }
            }
            
            // Try Trojan (check SHA224 hash + CRLF)
            if (verifyTrojanPassword(buffer, TROJAN_HASH)) {
                protocolDetected = 'Trojan';
                const request = parseTrojanRequest(buffer);
                if (request) {
                    const { host, port, remaining } = request;
                    ws.send(Buffer.from('\r\n')); // Trojan response
                    const duplex = createWebSocketStream(ws);
                    net.connect({ host, port }, function () {
                        if (remaining.length > 0) this.write(remaining);
                        duplex.on('error', () => { }).pipe(this).on('error', () => { }).pipe(duplex);
                    }).on('error', () => { });
                    console.log(`[Trojan] Connected: ${host}:${port}`);
                }
                return;
            }
            
            // Neither protocol matched
            console.log('[Unknown] Protocol detection failed, closing connection');
            ws.close();
        }).on('error', () => { });
    });
    
    console.log(`\n~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~`);
    console.log(`VLESS-WS-TLS 节点：vless://${UUID}@${DOMAIN}:443?encryption=none&security=tls&sni=${DOMAIN}&fp=chrome&type=ws&host=${DOMAIN}&path=%2F#Vl-ws-tls-${NAME}`);
    console.log(`Trojan-WS-TLS 节点：trojan://${TROJAN_PASS}@${DOMAIN}:443?sni=${DOMAIN}&fp=chrome&type=ws&host=${DOMAIN}&path=%2F#Tr-ws-tls-${NAME}`);
    console.log(`~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~`);
}

main();
