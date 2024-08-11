require('dotenv').config();

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require("fs");
const path = require("path");
const fetch = require('node-fetch');
const bodyParser = require('body-parser');
const { google } = require('googleapis');
const textToSpeech = require('@google-cloud/text-to-speech');
const util = require('util');

global.fetch = fetch;
global.Headers = fetch.Headers;
global.Request = fetch.Request;
global.Response = fetch.Response;


const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const port = process.env.PORT || 3000;

app.use(express.static('public'));
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

// Configure API key authorization
const keyFilename = 'google-cloud-credentials.json';
const client = new textToSpeech.TextToSpeechClient({
  keyFilename: keyFilename,
});

const rooms = {};

io.on('connection', (socket) => {
    socket.on('join-room', (roomInfo) => {
        const { roomId, username } = roomInfo;
        
        if (!rooms[roomId]) {
            rooms[roomId] = [];
        }

        if (rooms[roomId].length >= 2) {
            socket.emit('room-full');
            return;
        }

        const currentUsers = rooms[roomId].filter(user => user.id !== socket.id);
        socket.emit('current-users', currentUsers);
        
        rooms[roomId].push({ id: socket.id, username });
        socket.join(roomId);
        socket.to(roomId).emit('user-connected', {socketId: socket.id, username});

        // todo
        socket.on('user-leave', () => {
            rooms[roomId] = rooms[roomId].filter(id => id !== socket.id);
            if (rooms[roomId].length === 0) {
                delete rooms[roomId];
            } else {
                socket.to(roomId).emit('user-disconnected', socket.id);
            }
        });

        socket.on('offer', (roomId, offer) => {
            socket.broadcast.to(roomId).emit('offer', offer);
        });

        socket.on('answer', (roomId, answer) => {
            socket.broadcast.to(roomId).emit('answer', answer);
        });

        socket.on('ice-candidate', (roomId, candidate) => {
            socket.broadcast.to(roomId).emit('ice-candidate', candidate);
        });
    });

    // generate UUID
    socket.on('generateUUID', () => {
        const uuid = uuidv4();
        socket.emit('uuidGenerated', uuid);
    });
});

// ============================AI==================================
// Define the route to handle the image processing
app.get('/eye-of-ai', async (req, res)=>{
    res.sendFile(path.join(__dirname, 'public', 'eye-of-ai.html'));
});

app.post('/process-image', async (req, res) => {
    try {
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY, { fetch });
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const { imageData } = req.body;
      const result = await model.generateContent([
        "Describe shortly the image like its in front of me and do not use its a photo or something. Use third person.",
        { inlineData: { data: imageData, mimeType: 'image/png' } }
      ]);
  
      // Send the generated text as the response
      res.json({ text: result.response.text() });
    } catch (error) {
      console.error('Error generating content:', error);
      res.status(500).json({ error: 'Error generating content' });
    }
});

app.post('/play-audio', async(req, res) => {
    const { text } = req.body;
    const outputFile = "output.mp3";
    const request = {
        input: { text: text },
        voice: { languageCode: 'en-US', ssmlGender: 'NEUTRAL' },
        audioConfig: { audioEncoding: 'MP3' },
      };
    
      try {
          const [response] = await client.synthesizeSpeech(request);
          const writeFile = util.promisify(fs.writeFile);
          await writeFile(outputFile, response.audioContent, 'binary');
          res.sendFile(outputFile, { root: __dirname });
      } catch (err) {
        console.error('Error occurred:', err);
      }
    // let outputFile = synthesizeText("hello world! this is a audio test", "output.mp3");  
});

// -----------------------------------------------------------------

server.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
