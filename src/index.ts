import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import fs from 'fs';

const app = express();
const server = http.createServer(app);
const io = new Server(server);


app.use((req, _res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
})

// Serve .html files if they exist
app.get('*', (req, res) => {
    console.log(`Serving ${req.path}`);

    if(req.path.startsWith('/assets')) {
        if(fs.existsSync(path.resolve(path.join("./public/", req.path)))) {
            res.sendFile(path.resolve(path.join("./public/", req.path)));
        } else {
            res.status(404).send('File not found');
        }
        return
    }
    const filePath = req.path === '/' ? '/index.html' : `${req.path}.html`;
    const fullPath = path.resolve(path.join("./public/", filePath))
    res.sendFile(fullPath, (err) => {
        if (err) {
            res.status(404).send('File not found');
        }
    });
});


// Handle new websocket connections
io.on('connection', (socket) => {
    console.log('a user connected');

    // Handle joining a room
    socket.on('joinRoom', ({ username, room }) => {
        socket.join(room);
        socket.to(room).emit('message', `${username} has joined the room`);
    });

    // Handle sending a message
    socket.on('chatMessage', ({ room, message }) => {
        io.to(room).emit('message', message);
    });

    // Handle disconnect
    socket.on('disconnect', () => {
        console.log('user disconnected');
    });
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on: http://localhost:${PORT}`);
});