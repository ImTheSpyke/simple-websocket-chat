import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import fs from 'fs';
import * as SF from 'somefunctions'
import { generateRandomAvatar } from 'seedable-random-avatar-generator';
import * as uuid from 'uuid';

const app = express();
const server = http.createServer(app);
const io = new Server(server);



const CONFIG = {
    KEEP_TIME: isNaN(parseInt(`${process.env.KEEP_TIME}`)) ? 24*60*60*1000 : parseInt(`${process.env.KEEP_TIME}`) // 24 hours
}
console.log(`CONFIG:`, CONFIG);

import * as Types from './Types.js'


app.use((req, _res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
})


class ConfigManager {
    private configPath: string = path.resolve('./config.json')
    private config: {
        [key: string]: any,
        "adminKeys":string[],
        "rooms": Array<Types.Room>
    } | null

    constructor() {
        this.config = null
        this.loadConfig();
    }

    private loadConfig() {
        if (fs.existsSync(this.configPath)) {
            const data = fs.readFileSync(this.configPath, 'utf-8');
            this.config = JSON.parse(data);
            console.log(`Config loaded:`, this.config);
        } else {
            throw new Error(`Config file not found: ${this.configPath}`);
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

const configManager = new ConfigManager();

const Rooms: Map<string, Types.Room> = new Map();
const Users: Map<string, Types.User> = new Map();

configManager.get("rooms").forEach((room: Types.Room) => {
    Rooms.set(room.id, room);
})


function generateUser(username: string, socketId: string | null, rememberMe = false) {
    const userId = uuid.v4();

    return {
        id: userId,
        username,
        avatarUrl: generateRandomAvatar(userId),
        socketId,
        logged: true,
        rememberMe,
        expiresAt: Date.now() + 1000 * 60 * 60 * 24,
        lastSeenAt: Date.now(),
        roles: [],
    };
}

function createSessionForSocket(user: Types.User, socketId: string | null) {
    user.socketId = socketId;
    user.logged = true;
    user.lastSeenAt = Date.now();
    user.expiresAt = Date.now() + 1000 * 60 * 60 * 24;
    Users.set(user.id, user);
    return user;
}

function getUserFromSocketId(socketId: string | null) {
    return Array.from(Users.values()).find(u => u.socketId === socketId) || undefined;
}

function getUserFromId(userId: string) {
    return Users.get(userId);
}


setInterval(() => {
    const now = Date.now();

    Users.forEach((user) => {
        if (user.expiresAt < now) {
            if (user.socketId) {
                io.to(user.socketId).emit('loggedOut', { reason: 'Session expired' });
            }
            RM_Members.removeMemberFromAllRooms(user);
            Users.delete(user.id);
        }
    });
}, 60 * 1000); // 1 minute interval

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


function getRoomList(): Array<Types.Room> {
    const roomList = Array.from(Rooms.values());
    return roomList.map(room => {
        return {
            ...room,
            memberCount: RM_Members.getMembers(room.id).length,
            members: RM_Members.getMembers(room.id).map(member => {
                return {
                    id: member.id,
                    username: member.username,
                    avatarUrl: member.avatarUrl,
                }
            })
        }
    })
}


class RoomManager_Members {
    static RoomMembers: Map<string, Array<Types.User>> = new Map();
    constructor() { }
    addMember(roomId: string, user: Types.User) {
        if (RoomManager_Members.RoomMembers.has(roomId)) {
            const members = RoomManager_Members.RoomMembers.get(roomId);
            if (members) {
                members.push(user);
                RoomManager_Members.RoomMembers.set(roomId, members);
            }
        } else {
            RoomManager_Members.RoomMembers.set(roomId, [user]);
        }
    }
    removeMember(roomId: string, user: Types.User) {
        if (RoomManager_Members.RoomMembers.has(roomId)) {
            const members = RoomManager_Members.RoomMembers.get(roomId);
            if (members) {
                const index = members.indexOf(user);
                if (index > -1) {
                    members.splice(index, 1);
                    RoomManager_Members.RoomMembers.set(roomId, members);
                }
            }
        }
    }
    removeMemberFromAllRooms(user: Types.User) {
        RoomManager_Members.RoomMembers.forEach((members, roomId) => {
            if(members.find(member => ( (member.id === user.id) || (member.socketId === user.socketId) ))) {
                RoomManager_Members.RoomMembers.set(roomId, members.filter(member => member.id !== user.id));
            } 
        })
    }
    removeEveryMemberWithSocketId(socketId: string) {
        RoomManager_Members.RoomMembers.forEach((members, roomId) => {
            RoomManager_Members.RoomMembers.set(roomId, members.filter(member => member.socketId !== socketId));
        })
    }
    getMembers(roomId: string): Array<Types.User> {
        const members = RoomManager_Members.RoomMembers.get(roomId);
        if (members) {
            let temp: Types.User[] = members.map(user => Users.get(user.id) as Types.User);
            return temp
        } else {
            return [];
        }
    }
}

const RM_Members = new RoomManager_Members();

class RoomManager_Messages {
    keepTime: number
    clearCacheInterval: NodeJS.Timeout;
    static RoomMessages: Map<Types.Room['id'], Array<Types.Message>> = new Map();
    constructor(datas: {
        keepTime: number
    }) {
        this.keepTime = datas.keepTime;
        this.clearCacheInterval = setInterval(() => {
            // Clear all messages older than keepTime
            const now = Date.now();
            RoomManager_Messages.RoomMessages.forEach((messages, roomId) => {
                const newMessages = messages.filter(message => {
                    const messageTime = new Date(message.timestamp).getTime();
                    return (now - messageTime) < this.keepTime;
                });
                RoomManager_Messages.RoomMessages.set(roomId, newMessages);
            })

        }, 60*1000);
    }
    addMessage(roomId: string, message: Types.Message) {
        if (RoomManager_Messages.RoomMessages.has(roomId)) {
            const messages = RoomManager_Messages.RoomMessages.get(roomId);
            if (messages) {
                messages.push(message);
                RoomManager_Messages.RoomMessages.set(roomId, messages);
            }
        } else {
            RoomManager_Messages.RoomMessages.set(roomId, [message]);
        }
    }
    getMessages(roomId: string): Array<Types.Message> {
        const messages = RoomManager_Messages.RoomMessages.get(roomId);
        if (messages) {
            return messages;
        } else {
            return [];
        }
    }
    clearMessagesInRoom(roomId: string) {
        RoomManager_Messages.RoomMessages.set(roomId, []);
    }
    clearMessagesInAllRooms() {
        RoomManager_Messages.RoomMessages.clear();
    }

    deleteMessage(roomId: string, messageId: string): boolean {
        const messages = RoomManager_Messages.RoomMessages.get(roomId);
        if (messages) {
            const index = messages.findIndex(message => message.id === messageId);
            if (index > -1) {
                messages.splice(index, 1);
                RoomManager_Messages.RoomMessages.set(roomId, messages);
                return true
            }
            return false
        } else {
            return false
        }
    }
}

const RM_Messages = new RoomManager_Messages({
    keepTime: CONFIG.KEEP_TIME
});


setInterval(() => {
    console.log(`DEBUG: Messages:`, RoomManager_Messages.RoomMessages)
    console.log(`DEBUG Members:`, RoomManager_Members.RoomMembers)
}, 1000)


io.on('connection', (socket) => {
    console.log(`[socket][${socket.id}] Connected.`);

    function isConnected() {
        const user = getUserFromSocketId(socket.id);
        if (!user) {
            socket.emit('loggedOut', { reason: 'User not found' });
            return false;
        }
        return true;
    }

    socket.on('login', ({ username, rememberMe }) => {
        const usernameRegex = /^[a-zA-Z0-9_\.\- ]+$/;

        if (!usernameRegex.test(username)) {
            socket.emit('loginError', {
                message: 'Invalid username. Only alphanumeric characters, underscores, hyphens, dots, and spaces are allowed.'
            });
            return;
        }

        const user = generateUser(username, socket.id, !!rememberMe);
        Users.set(user.id, user);

        socket.data.userId = user.id;

        socket.emit('loginSuccess', {
            userId: user.id,
            username: user.username,
            rememberMe: user.rememberMe,
            expiresAt: new Date(user.expiresAt).toISOString()
        });

        io.emit('roomList', getRoomList());
    });

    socket.on('resumeSession', ({ userId }) => {
        const user = getUserFromId(userId);

        if (!user) {
            socket.emit('loggedOut', { reason: 'Session not found' });
            return;
        }

        if (user.expiresAt < Date.now()) {
            Users.delete(user.id);
            socket.emit('loggedOut', { reason: 'Session expired' });
            return;
        }

        createSessionForSocket(user, socket.id);
        socket.data.userId = user.id;

        socket.emit('loginSuccess', {
            userId: user.id,
            username: user.username,
            rememberMe: user.rememberMe,
            expiresAt: new Date(user.expiresAt).toISOString()
        });

        io.emit('roomList', getRoomList());
    });

    socket.on('disconnect', () => {
        console.log(`[socket][${socket.id}] Disconnected.`);

        const user = getUserFromSocketId(socket.id);
        if (user) {
            user.socketId = null;
            user.logged = false;
            user.lastSeenAt = Date.now();
            Users.set(user.id, user);
        }

        RM_Members.removeEveryMemberWithSocketId(socket.id);
        io.emit('roomList', getRoomList());
    });

    socket.on('sendMessage', (datas) => {
        if (!isConnected()) return;

        const user = getUserFromSocketId(socket.id);
        if (!user) return;

        const message = {
            id: `${Date.now().toString().substring(5)}-${SF.Random.randHex(6)}`,
            content: datas.content,
            author: user.username,
            authorId: user.id,
            authorAvatarUrl: user.avatarUrl,
            timestamp: new Date().toISOString(),
            attachments: []
        };

        const socketRoom = [...socket.rooms.values()].find(room => room.startsWith('room-'))?.replace('room-', '') ?? null;
        if (!socketRoom) {
            socket.emit('error', { message: 'Not in a room' });
            return;
        }

        RM_Messages.addMessage(socketRoom, message);

        [...socket.rooms.values()]
            .filter(room => room.startsWith('room-'))
            .forEach(room => io.to(room).emit('message', message));
    });

    socket.on('getRooms', () => {
        if (!isConnected()) return;
        socket.emit('roomList', getRoomList());
    });

    socket.on('joinRoom', (roomId) => {
        if (!isConnected()) return;

        const user = getUserFromSocketId(socket.id);

        socket.rooms.forEach(room => {
            if (room !== socket.id) socket.leave(room);
        });

        if (!Rooms.has(roomId)) {
            socket.emit('error', { message: 'Room not found' });
            socket.emit('joinedRoom', null);
            io.emit('roomList', getRoomList());
            return;
        }

        if (user) {
            RM_Members.removeMemberFromAllRooms(user);
            RM_Members.addMember(roomId, user);
        }

        socket.join(`room-${roomId}`);
        socket.emit('joinedRoom', roomId);
        io.emit('roomList', getRoomList());
    });

    socket.on('getMembersInRoom', (roomId) => {
        if (!isConnected()) return;

        if (!Rooms.has(roomId)) {
            socket.emit('error', { message: 'Room not found' });
            return;
        }

        socket.emit('membersInRoom', RM_Members.getMembers(roomId));
    });

    socket.on('getRoomHistory', (roomId) => {
        if (!isConnected()) return;
        socket.emit('roomHistory', RM_Messages.getMessages(roomId));
    });
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


// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on: http://localhost:${PORT}`);
});