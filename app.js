const os = require('os');
const http = require('http');
const net = require('net');
const { WebSocket, createWebSocketStream } = require('ws');

const NAME = process.env.NAME || os.hostname();
// Cloud Run sets PORT env var (usually 8080). Default to 8080 if missing.
const PORT = process.env.PORT || 8080; 
const UUID = process.env.UUID || 'adfc1482-c28a-0765-7078-93fd14de1c63';
const DOMAIN_FALLBACK = process.env.DOMAIN || '';

console.log("~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~");
console.log("Nodejs VLESS Proxy - Cloud Run Optimized");
console.log("Listening on Port:", PORT);
console.log("~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~");

const httpServer = http.createServer((req, res) => {
    if (req.url === '/') {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found \n');
    } else if (req.url === `/${UUID}`) {
        // AUTO-DETECT: Grab domain from Host header
        const actualDomain = req.headers.host || DOMAIN_FALLBACK || 'unknown.domain';
        
        let vlessURL;
        if (NAME.includes('server') || NAME.includes('hostypanel')) {
            const baseParams = `?encryption=none&security=tls&sni=${actualDomain}&fp=chrome&type=ws&host=${actualDomain}&path=%2F#Vl-ws-tls-${NAME}`;
            vlessURL = `vless://${UUID}@${actualDomain}:443${baseParams}
vless://${UUID}@104.16.0.0:443${baseParams}
vless://${UUID}@104.17.0.0:443${baseParams}
vless://${UUID}@104.18.0.0:443${baseParams}
vless://${UUID}@104.19.0.0:443${baseParams}
vless://${UUID}@104.20.0.0:443${baseParams}
vless://${UUID}@104.21.0.0:443${baseParams}
vless://${UUID}@104.22.0.0:443${baseParams}
vless://${UUID}@104.24.0.0:443${baseParams}
vless://${UUID}@104.25.0.0:443${baseParams}
vless://${UUID}@104.26.0.0:443${baseParams}
vless://${UUID}@104.27.0.0:443${baseParams}
vless://${UUID}@[2606:4700::]:443${baseParams}
vless://${UUID}@[2400:cb00:2049::]:443${baseParams}
`;
        } else {
            vlessURL = `vless://${UUID}@${actualDomain}:443?encryption=none&security=tls&sni=${actualDomain}&fp=chrome&type=ws&host=${actualDomain}&path=%2F#Vl-ws-tls-${NAME}`;
        }
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(vlessURL + '\n');
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
    ws.once('message', msg => {
        const [VERSION] = msg;
        const id = msg.slice(1, 17);
        if (!id.every((v, i) => v == parseInt(uuid.substr(i * 2, 2), 16))) return;
        let i = msg.slice(17, 18).readUInt8() + 19;
        const port = msg.slice(i, i += 2).readUInt16BE(0);
        const ATYP = msg.slice(i, i += 1).readUInt8();
        const host = ATYP == 1 ? msg.slice(i, i += 4).join('.') :
            (ATYP == 2 ? new TextDecoder().decode(msg.slice(i + 1, i += 1 + msg.slice(i, i + 1).readUInt8())) :
                (ATYP == 3 ? msg.slice(i, i += 16).reduce((s, b, i, a) => (i % 2 ? s.concat(a.slice(i - 1, i + 1)) : s), []).map(b => b.readUInt16BE(0).toString(16)).join(':') : ''));
        ws.send(new Uint8Array([VERSION, 0]));
        const duplex = createWebSocketStream(ws);
        net.connect({ host, port }, function () {
            this.write(msg.slice(i));
            duplex.on('error', () => { }).pipe(this).on('error', () => { }).pipe(duplex);
        }).on('error', () => { });
    }).on('error', () => { });
});

console.log(`vless-ws-tls node ready. Visit https://<your-cloudrun-url>/${UUID} to get config`);
