const { Client,LocalAuth } = require('whatsapp-web.js');
const qrcode = require("qrcode");
const express = require("express");
const fileUpload = require('express-fileupload');
const cors = require('cors');
const bodyParser = require("body-parser");
const app = require("express")()
const server = require("http").createServer(app);
const io = require("socket.io")(server);
const port = process.env.PORT || 8002;

app.use(fileUpload({
    createParentPath: true
}));

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));
let soket;
let qrwa;
let connectionWA = 'loading'

app.use("/assets", express.static(__dirname + "/client/assets"));

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--unhandled-rejections=strict"
        ]
    },
});

client.on('ready', () => {
    connectionWA = 'connected';
    soket?.emit("qrstatus", {status: 'connected', url:"./assets/checked.json"});
});

client.on('qr', qr => {
    connectionWA = 'ready to use';
    qrwa = qr
    qrcode.toDataURL(qr, (err, url) => {
        soket?.emit("qrstatus", {status: 'qrcode',url: url});
        soket?.emit("log", "QR Code received, please scan");
    });
    qrcode.generate(qr, {small: true});
});

client.on('state_changed', message => {
    console.log(message)
})

client.on('disconnected', (reason) => {
    console.log('Client was logged out', reason);
    client.initialize() // this what i was need
});

client.on('message_create', message => {
	if (message.body === '!ping') {
        client.sendMessage(message.from, 'Hallo Ada Apa?, Saya Bot');
	}
});

client.initialize();

io.on("connection", async (socket) => {
    soket = socket;
    soket?.emit("qrstatus", {status:'loading',url:''});
    socket?.on('load',async () => {
        const connectionStatus = await client.getState()
        if(connectionStatus == null){
            if(connectionWA == 'ready to use'){
                qrcode.toDataURL(qrwa, (err, url) => {
                    soket?.emit("qrstatus", {status: 'qrcode',url: url});
                    soket?.emit("log", "QR Code received, please scan");
                });
            }else if(connectionWA == 'connected'){
                soket?.emit("qrstatus", {status: 'connected', url:"./assets/checked.json"});
            }
        }else{
            soket?.emit("qrstatus", {status: 'connected', url:"./assets/checked.json"});
        }
    })
});

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

app.post("/send-message", async (req, res) =>{
    const message = req.body.message;
    const number = req.body.number;
    const connectionStatus = await client.getState()
    
	let numberWA;
    try {
        if(!number) {
            res.status(500).json({
               status: false,
               response: 'Nomor WA tidak boleh kosong'
           });
       }else{
           numberWA = '62' + number.substring(1) + "@s.whatsapp.net"; 

           if (connectionStatus == "CONNECTED") {
                client.sendMessage(numberWA, message).then((result) => {
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
                   response: `WhatsApp belum terhubung.`,
               });
           }    
       }
    } catch (err) {
        console.log(err)
        res.status(500).send(err);
    }
    
});

server.listen(port, () => {
    console.log("server running on port : " + port);
});