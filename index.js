const {
    default: makeWASocket,
	MessageType, 
    MessageOptions, 
    Mimetype,
	DisconnectReason,
	BufferJSON,
    AnyMessageContent, 
	delay, 
	fetchLatestBaileysVersion, 
	isJidBroadcast, 
	makeCacheableSignalKeyStore, 
	makeInMemoryStore, 
	MessageRetryMap, 
	useMultiFileAuthState,
	msgRetryCounterMap
} =require("@adiwajshing/baileys");

const log = (pino = require("pino"));
const { session } = {"session": "baileys_auth_info"};
const { Boom } =require("@hapi/boom");
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const express = require("express");
const fileUpload = require('express-fileupload');
const cors = require('cors');
const bodyParser = require("body-parser");
const app = require("express")()

app.use(fileUpload({
    createParentPath: true
}));

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));
const server = require("http").createServer(app);
const io = require("socket.io")(server);
const port = process.env.PORT || 8000;
const qrcode = require("qrcode");

app.use("/assets", express.static(__dirname + "/client/assets"));

app.get("/scan", (req, res) => {
  res.sendFile("./client/server.html", {
    root: __dirname,
  });
});

app.get("/", (req, res) => {
  res.sendFile("./client/index.html", {
    root: __dirname,
  });
});

const store = makeInMemoryStore({ logger: pino().child({ level: "silent", stream: "store" }) });

let sock;
let qr;
let soket;

/** 
 * Start Connect To WA
*/
async function connectToWhatsApp() {
	const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info')
	let { version, isLatest } = await fetchLatestBaileysVersion();
    sock = makeWASocket({
        printQRInTerminal: false,
		auth: state,
		logger: log({ level: "silent" }),
		version: [2,2323,4],
		shouldIgnoreJid: jid => isJidBroadcast(jid)
    });
	store.bind(sock.ev);
	sock.multi = true

    sock.ev.on('connection.update', async (update) => {
		const { connection, lastDisconnect } = update;
		if(connection === 'close') {
            let reason = new Boom(lastDisconnect.error).output.statusCode;
			if (reason === DisconnectReason.badSession) {
				console.log(`Bad Session File, Please Delete ${session} and Scan Again`);
				sock.logout();
			} else if (reason === DisconnectReason.connectionClosed) {
				console.log("Connection closed, reconnecting....");
				connectToWhatsApp();
			} else if (reason === DisconnectReason.connectionLost) {
				console.log("Connection Lost from Server, reconnecting...");
				connectToWhatsApp();
			} else if (reason === DisconnectReason.connectionReplaced) {
				console.log("Connection Replaced, Another New Session Opened, Please Close Current Session First");
				sock.logout();
			} else if (reason === DisconnectReason.loggedOut) {
				console.log(`Device Logged Out, Please Delete ${session} and Scan Again.`);
				sock.logout();
			} else if (reason === DisconnectReason.restartRequired) {
				console.log("Restart Required, Restarting...");
				connectToWhatsApp();
			} else if (reason === DisconnectReason.timedOut) {
				console.log("Connection TimedOut, Reconnecting...");
				connectToWhatsApp();
			} else {
				sock.end(`Unknown DisconnectReason: ${reason}|${lastDisconnect.error}`);
			}
        }else if(connection === 'open') {
            if(isConnected){
                updateQR("qrscanned");
            }
			let getGroups = await sock.groupFetchAllParticipating();
			let groups = Object.entries(getGroups).slice(0).map(entry => entry[1]);
			return;
        } 

        if (update.qr){
            qr = update.qr;
            updateQR("qr");
        }else if(qr == undefined){
            updateQR("loading");
        }
    });
	sock.ev.on("creds.update", saveCreds);
	sock.ev.on("messages.upsert", async ({ messages, type }) => {
        if(type === "notify"){
            if(!messages[0].key.fromMe) {
                const pesan = messages[0].message.conversation;
                const noWa = messages[0].key.remoteJid;
                await sock.readMessages([messages[0].key]);
                const pesanMasuk = pesan.toLowerCase();
				
                if(!messages[0].key.fromMe && pesanMasuk === "ping"){
                    await sock.sendMessage(noWa, {text: "Pong"},{quoted: messages[0] });
                }else{
                    await sock.sendMessage(noWa, {text: "Terimakasih Sudah Menghubungi, mohon bersabar untuk mendapatkan balasan selanjutnya. Saya adalah Bot!"},{quoted: messages[0] });
                }
			}		
		}		
    });
}

/**
 * Start Socket
 */
io.on("connection", async (socket) => {
    soket = socket;

    if (isConnected) {
        updateQR("connected");
    } else if (qr) {
        updateQR("qr");   
    }
});

/**
 * Function check connection WA account
 */
const isConnected = () => {
    return (sock.user)
};

/**
 * Function emit message for update response to view
 */
const updateQR = (data) => {
    switch (data) {
        case "qr":
            qrcode.toDataURL(qr, (err, url) => {
                soket?.emit("qr", url);
                soket?.emit("log", "QR Code received, please scan");
            });
            break;
        case "connected":
            soket?.emit("qrstatus", "./assets/check.svg");
            soket?.emit("log", "WhatsApp terhubung");
            break;
        case "qrscanned":
            soket?.emit("qrstatus", "./assets/check.svg");
            soket?.emit("log", "QR Code berhasil discan");
            break;
        case "loading":
            soket?.emit("qrstatus", "./assets/loader.gif");
            soket?.emit("log", "Registering QR Code , please wait");
            break;
        default:
            break;
    }
};

/**
 * Send Message
 */
app.post("/send-message", async (req, res) =>{
    const pesankirim = req.body.message;
    const number = req.body.number;
    const fileDikirim = req.files;
    
	let numberWA;
    try {
        if(!number) {
            res.status(500).json({
               status: false,
               response: 'Nomor WA tidak boleh kosong'
           });
       }else{
           numberWA = '62' + number.substring(1) + "@s.whatsapp.net"; 

           if (isConnected) {
               const exists = await sock.onWhatsApp(numberWA);
               if (exists?.jid || (exists && exists[0]?.jid)) {
                   sock.sendMessage(exists.jid || exists[0].jid, { text: pesankirim })
                   .then((result) => {
                       res.status(200).json({
                           status: true,
                           response: result,
                       });
                   })
                   .catch((err) => {
                       res.status(500).json({
                           status: false,
                           response: err,
                       });
                   });
               } else {
                   res.status(500).json({
                       status: false,
                       response: `Nomor ${number} tidak terdaftar.`,
                   });
               }
           } else {
               res.status(500).json({
                   status: false,
                   response: `WhatsApp belum terhubung.`,
               });
           }    
       }
    } catch (err) {
        res.status(500).send(err);
    }
    
});


/**
 * Start Function To Connect WA
 */
connectToWhatsApp()
.catch (err => console.log("unexpected error: " + err) )
server.listen(port, () => {
  console.log("server running on port : " + port);
});
