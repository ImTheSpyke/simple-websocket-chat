import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import fs from 'fs';

const app = express();
const server = http.createServer(app);
const io = new Server(server);


import * as Types from './Types.js'


app.use((req, _res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
})


class ConfigManager {
    private configPath: string;
    private config: {
        [key: string]: any,
        "adminKeys":string[],
        "defaultRoom": string,
        "rooms": Array<Types.Room>
    } | null

    constructor(configPath: string) {
        this.configPath = configPath;
        this.loadConfig();
        this.config = null
    }

    private loadConfig() {
        if (fs.existsSync(this.configPath)) {
            const data = fs.readFileSync(this.configPath, 'utf-8');
            this.config = JSON.parse(data);
        }
    }

    private saveConfig() {
        const data = JSON.stringify(this.config, null, 2);
        fs.writeFileSync(this.configPath, data, 'utf-8');
    }

    public get(key: string) {
        return this.config?.[key]
    }

    public set(key: string, value: any) {
        if(this.config) {
            this.config[key] = value;
            this.saveConfig();
        }
    }

    public delete(key: string) {
        if(this.config) {
            delete this.config[key];
            this.saveConfig();
        }
    }
}

const configManager = new ConfigManager(path.resolve('./config.json'));

//const RoomMessages = new Map<string, Types.Message[]>();
const Rooms: Map<string, Types.Room> = new Map();
const Users: Map<string, Types.User> = new Map();

configManager.get('rooms').forEach((room: Types.Room) => {
    Rooms.set(room.id, room);
})


function generateUser(username: string, socketId: string): Types.User {
    let user = {
        logged: true,
        socketId: socketId,
        // ID is hash from username
        id: Buffer.from(username).toString('base64'),
        username: username,
        expiresAt: Date.now() + 1000 * 60 * 60 * 24, // 24 hours
        roles: [],
        inRoomId: '' // Initialize with an empty string or null if not in a room
    }
    return user;
}


setInterval(() => {
    const now = Date.now();
    Users.forEach((user) => {
        if (user.expiresAt < now) {
            Users.delete(user.id);
            io.to(user.socketId).emit('loggedOut', {
                reason: 'Session expired'
            });
        }
        if(user.logged !== true) {
            Users.delete(user.id);
            io.to(user.socketId).emit('loggedOut', {
                reason: 'Session expired'
            });
        }
    });
}, 1000 * 60 * 60); // 1 hour

/*
export type User = {
    logged: boolean
    socketId: string
    id: string
    username: string
    expiresAt: number
    roles: Array<Role>
}

export type Role = {
    name: string,
    color: string,
    id: string
}
*/



io.on('connection', (socket) => {
    console.log(`[socket][${socket.id}] Connected.`);

    /*
    socket.on('joinRoom', ({ username, room }) => {
        socket.join(room);
        socket.to(room).emit('message', `${username} has joined the room`);
    });
    */

    socket.on('message', ({ userId, message }: {
        userId: string,
        message: Types.Message
    }) => {
        let user = Users.get(userId);
        if (!user) {
            socket.emit('loggedOut', {
                reason: 'User not found'
            });
            return;
        }
        if(message) {}
        //io.to(room).emit('message', message);
    });

    socket.on('disconnect', () => {
        console.log(`[socket][${socket.id}] Disconnected.`);

        const userId = Users.get(socket.id);
        if (userId) {
            Users.delete(socket.id);
        }

    });

    socket.on('login', (datas: { username: string }) => {
        const usernameRegex = /^[a-zA-Z0-9_\.\- ]+$/;

        if (!usernameRegex.test(datas.username)) {
            socket.emit('loginError', { message: 'Invalid username. Only alphanumeric characters, underscores, hyphens, dots, and spaces are allowed.' });
            return;
        }

        const user = generateUser(datas.username, socket.id);
        Users.set(user.id, user);
        socket.emit('loginSuccess', {
            userId: user.id,
            username: user.username,
            expiresAt: user.expiresAt
        });

    })
});


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