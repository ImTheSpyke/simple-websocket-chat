import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import fs from 'fs';
import * as SF from 'somefunctions'

const app = express();
const server = http.createServer(app);
const io = new Server(server);


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


function generateUser(username: string, socketId: string): Types.User {
    const userID = Buffer.from(username).toString('base64');
    let user = {
        logged: true,
        socketId: socketId,
        // ID is hash from username
        id: userID,
        avatarUrl: `https://robohash.org/${username}`,
        username: username,
        expiresAt: Date.now() + 1000 * 60 * 60 * 24, // 24 hours
        roles: [],
    }
    return user;
}

function getUserFromSocketId(socketId: string): Types.User | undefined {
    const user = Array.from(Users.values()).find(u => u.socketId === socketId);
    return user;
}


setInterval(() => {
    const now = Date.now();
    Users.forEach((user) => {
        if (user.expiresAt < now) {
            Users.delete(user.id);
            RM_Members.removeMemberFromAllRooms(user);
            io.to(user.socketId).emit('loggedOut', {
                reason: 'Session expired'
            });
        }
        if(user.logged !== true) {
            Users.delete(user.id);
            RM_Members.removeMemberFromAllRooms(user);
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
    static RoomMessages: Map<Types.Room['id'], Array<Types.Message>> = new Map();
    constructor() { }
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

const RM_Messages = new RoomManager_Messages();


setInterval(() => {
    console.log(`DEBUG: Messages:`, RoomManager_Messages.RoomMessages)
}, 1000)


io.on('connection', (socket) => {
    console.log(`[socket][${socket.id}] Connected.`);

    /*
    socket.on('joinRoom', ({ username, room }) => {
        socket.join(room);
        socket.to(room).emit('message', `${username} has joined the room`);
    });
    */

    function isConnected(): boolean {
        const user = getUserFromSocketId(socket.id);
        if (!user) {
            socket.emit('loggedOut', {
                reason: 'User not found'
            });
            return false
        }
        return true
    }

    function getRoomId(): string | null {
        let roomId = [...socket.rooms.values()].find(room => { return room.startsWith('room-') }) ?? null
        if (roomId) {
            return roomId.replace("room-", '');
        }
        return null;
    }

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


    const socket_id = socket.id;
    socket.on('disconnect', () => {
        console.log(`[socket][${socket.id}] Disconnected.`);
        const user = getUserFromSocketId(socket_id);
        if(user) {
            RM_Members.removeMemberFromAllRooms(user);
        }
        RM_Members.removeEveryMemberWithSocketId(socket_id);

        const userId = getUserFromSocketId(socket_id)?.id;
        if (userId) {
            Users.delete(socket.id);
        }

    });


    socket.on('relogin', (datas: {
        userId: Types.User['id'],
        username: Types.User['username'],
        expiresAt: Types.User['expiresAt']
    }) => {
        console.log('relogin', datas);
        const user = Users.get(datas.userId);
        if (user) {
            user.socketId = socket.id;
            user.logged = true;
            Users.set(user.id, user);
            socket.emit('loginSuccess', {
                userId: user.id,
                username: user.username,
                expiresAt: (new Date(user.expiresAt)).toISOString()
            });
        } else {
            socket.emit('loggedOut', {
                reason: 'User not found'
            });
        }
    })
    
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
            expiresAt: (new Date(user.expiresAt)).toISOString()
        });
    })



    socket.on('getRooms', () => {
        if(!isConnected()) { return }
        let roomList = Array.from(Rooms.values())
        roomList = roomList.map(room => {
            return {
                ...room,
                memberCount: RM_Members.getMembers(room.id).length
            }
        })
        socket.emit('roomList', roomList);
    });

    socket.on('joinRoom', (roomId: string) => {
        if(!isConnected()) { return }
        const user = getUserFromSocketId(socket.id);

        socket.rooms.forEach(room => {if (room !== socket.id) {socket.leave(room);}});

        if(!Rooms.has(roomId)) {
            socket.emit('error', { message: 'Room not found' });
            socket.emit('joinedRoom', null);
            return;
        } else {
            console.log(`[joinRoom] joined room 'room-${roomId}'`);
            socket.join(`room-${roomId}`);
            socket.emit('joinedRoom', roomId);
            if(user) {
                RM_Members.removeMemberFromAllRooms(user);
                RM_Members.addMember(roomId, user);
            }
        }
    })

    socket.on('getMembersInRoom', (roomId: string) => {
        if(!isConnected()) { return }
        const room = Rooms.get(roomId);
        if (!room) {
            socket.emit('error', { message: 'Room not found' });
            return;
        }
        const members = RM_Members.getMembers(roomId);
        socket.emit('membersInRoom', members);
    })

    socket.on('sendMessage', (datas: {
        content: string,
        attachments: Array<Types.Attachment>
    }) => {
        if(!isConnected()) { return }
        const user = getUserFromSocketId(socket.id);
        if (!user) {return}

        const message: Types.Message = {
            id: `${Date.now().toString().substring(5)}-${SF.Random.randHex(6)}`,
            content: datas.content,
            author: user.username,
            authorId: user.id,
            authorAvatarUrl: user.avatarUrl,
            timestamp: (new Date()).toISOString(),
            attachments: []
        }

        let socketRoom = getRoomId();
        if(!socketRoom) {
            console.log(`[sendMessage] Not in a room`);
            socket.emit('error', { message: 'Not in a room' });
            return;
        }


        RM_Messages.addMessage(socketRoom, message);

        const rooms = [...socket.rooms.values()].filter(room => { return room.startsWith('room-') });
        console.log(`[sendMessage] Rooms:`, rooms);
        rooms.forEach(room => {
            io.to(room).emit('message', message);
        });
    })

    socket.on('getRoomHistory', (roomId: string) => {
        if(!isConnected()) { return }
        const messages = RM_Messages.getMessages(roomId);
        socket.emit('roomHistory', messages);
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


// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on: http://localhost:${PORT}`);
});