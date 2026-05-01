import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import fs from 'fs';
import * as SF from 'somefunctions';
import { generateRandomAvatar } from 'seedable-random-avatar-generator';
import * as uuid from 'uuid';
import * as Types from './Types.js';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const CONFIG = {
  KEEP_TIME: isNaN(parseInt(`${process.env.KEEP_TIME}`))
    ? 24 * 60 * 60 * 1000
    : parseInt(`${process.env.KEEP_TIME}`), // 24 hours
};

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const TEMP_SESSION_GRACE_MS = 2 * 60 * 1000;
//const HEARTBEAT_INTERVAL_MS = 5 * 1000;
const HEARTBEAT_TIMEOUT_MS = 15 * 1000;

console.log('CONFIG:', CONFIG);

app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

type SessionUser = {
  id: string;
  username: string;
  avatarUrl: string;
  socketId: string | null;
  logged: boolean;
  connected: boolean;
  rememberMe: boolean;
  expiresAt: number | null;
  disconnectAt: number | null;
  lastSeenAt: number;
  lastPingAt: number;
  roles: Array<Types.Role>;
};

type LoginSuccessPayload = {
  userId: string;
  username: string;
  rememberMe: boolean;
  expiresAt: string | null;
};

type ResumeSessionPayload = {
  userId: string;
};

type PingPayload = {
  userId?: string;
};

class ConfigManager {
  private configPath: string = path.resolve('./config.json');
  private config: {
    [key: string]: any;
    adminKeys: string[];
    rooms: Array<Types.Room>;
  } | null;

  constructor() {
    this.config = null;
    this.loadConfig();
  }

  private loadConfig() {
    if (fs.existsSync(this.configPath)) {
      const data = fs.readFileSync(this.configPath, 'utf-8');
      this.config = JSON.parse(data);
      console.log('Config loaded:', this.config);
    } else {
      throw new Error(`Config file not found: ${this.configPath}`);
    }
  }

  private saveConfig() {
    const data = JSON.stringify(this.config, null, 2);
    fs.writeFileSync(this.configPath, data, 'utf-8');
  }

  public get(key: string) {
    return this.config?.[key];
  }

  public set(key: string, value: any) {
    if (this.config) {
      this.config[key] = value;
      this.saveConfig();
    }
  }

  public delete(key: string) {
    if (this.config) {
      delete this.config[key];
      this.saveConfig();
    }
  }
}

const configManager = new ConfigManager();

const Rooms: Map<string, Types.Room> = new Map();
const Users: Map<string, SessionUser> = new Map();

const roomsFromConfig = configManager.get('rooms');
if (Array.isArray(roomsFromConfig)) {
  roomsFromConfig.forEach((room: Types.Room) => {
    Rooms.set(room.id, room);
  });
}

function createUser(username: string, socketId: string | null, rememberMe = false): SessionUser {
  const userId = uuid.v4();
  const now = Date.now();

  return {
    id: userId,
    username,
    avatarUrl: generateRandomAvatar(userId),
    socketId,
    logged: true,
    connected: true,
    rememberMe,
    expiresAt: rememberMe ? now + SESSION_TTL_MS : null,
    disconnectAt: null,
    lastSeenAt: now,
    lastPingAt: now,
    roles: [],
  };
}

function attachSocketToUser(user: SessionUser, socketId: string): SessionUser {
  const now = Date.now();

  user.socketId = socketId;
  user.logged = true;
  user.connected = true;
  user.lastSeenAt = now;
  user.lastPingAt = now;
  user.disconnectAt = null;

  if (user.rememberMe) {
    user.expiresAt = now + SESSION_TTL_MS;
  } else {
    user.expiresAt = null;
  }

  Users.set(user.id, user);
  return user;
}

function markUserDisconnected(user: SessionUser): SessionUser {
  const now = Date.now();

  user.socketId = null;
  user.logged = false;
  user.connected = false;
  user.lastSeenAt = now;

  if (user.rememberMe) {
    user.disconnectAt = now;
    user.expiresAt = now + SESSION_TTL_MS;
  } else {
    user.disconnectAt = now;
    user.expiresAt = now + TEMP_SESSION_GRACE_MS;
  }

  Users.set(user.id, user);
  return user;
}

function getUserFromSocketId(socketId: string | null): SessionUser | undefined {
  return Array.from(Users.values()).find((u) => u.socketId === socketId);
}

function getUserFromId(userId: string): SessionUser | undefined {
  return Users.get(userId);
}

function getSocketUser(socket: import('socket.io').Socket): SessionUser | undefined {
  return getUserFromSocketId(socket.id);
}

class RoomManager_Members {
  static RoomMembers: Map<string, Array<SessionUser>> = new Map();

  addMember(roomId: string, user: SessionUser) {
    const current = RoomManager_Members.RoomMembers.get(roomId) ?? [];
    const exists = current.some((member) => member.id === user.id);

    if (!exists) {
      current.push(user);
      RoomManager_Members.RoomMembers.set(roomId, current);
    }
  }

  removeMember(roomId: string, user: SessionUser) {
    const current = RoomManager_Members.RoomMembers.get(roomId);
    if (!current) return;

    RoomManager_Members.RoomMembers.set(
      roomId,
      current.filter((member) => member.id !== user.id)
    );
  }

  removeMemberFromAllRooms(user: SessionUser) {
    RoomManager_Members.RoomMembers.forEach((members, roomId) => {
      const filtered = members.filter((member) => member.id !== user.id);
      RoomManager_Members.RoomMembers.set(roomId, filtered);
    });
  }

  removeEveryMemberWithSocketId(socketId: string) {
    RoomManager_Members.RoomMembers.forEach((members, roomId) => {
      const filtered = members.filter((member) => member.socketId !== socketId);
      RoomManager_Members.RoomMembers.set(roomId, filtered);
    });
  }

  getMembers(roomId: string): Array<SessionUser> {
    const members = RoomManager_Members.RoomMembers.get(roomId) ?? [];
    return members
      .map((user) => Users.get(user.id))
      .filter((user): user is SessionUser => Boolean(user));
  }

}

const RM_Members = new RoomManager_Members();

class RoomManager_Messages {
  keepTime: number;
  clearCacheInterval: NodeJS.Timeout;
  static RoomMessages: Map<Types.Room['id'], Array<Types.Message>> = new Map();

  constructor(datas: { keepTime: number }) {
    this.keepTime = datas.keepTime;

    this.clearCacheInterval = setInterval(() => {
      const now = Date.now();

      RoomManager_Messages.RoomMessages.forEach((messages, roomId) => {
        const newMessages = messages.filter((message) => {
          const messageTime = new Date(message.timestamp).getTime();
          return now - messageTime < this.keepTime;
        });

        RoomManager_Messages.RoomMessages.set(roomId, newMessages);
      });
    }, 60 * 1000);
  }

  addMessage(roomId: string, message: Types.Message) {
    const current = RoomManager_Messages.RoomMessages.get(roomId) ?? [];
    current.push(message);
    RoomManager_Messages.RoomMessages.set(roomId, current);
  }

  getMessages(roomId: string): Array<Types.Message> {
    return RoomManager_Messages.RoomMessages.get(roomId) ?? [];
  }

  clearMessagesInRoom(roomId: string) {
    RoomManager_Messages.RoomMessages.set(roomId, []);
  }

  clearMessagesInAllRooms() {
    RoomManager_Messages.RoomMessages.clear();
  }

  deleteMessage(roomId: string, messageId: string): boolean {
    const messages = RoomManager_Messages.RoomMessages.get(roomId);
    if (!messages) return false;

    const index = messages.findIndex((message) => message.id === messageId);
    if (index === -1) return false;

    messages.splice(index, 1);
    RoomManager_Messages.RoomMessages.set(roomId, messages);
    return true;
  }
}

const RM_Messages = new RoomManager_Messages({
  keepTime: CONFIG.KEEP_TIME,
});

function getRoomList(): Array<Types.Room> {
  return Array.from(Rooms.values()).map((room) => {
    const members = RM_Members.getMembers(room.id);

    return {
      ...room,
      memberCount: members.filter(user => {
            // Remove users disconnected for more than 1h
            return user.connected
      }).length,
      members: members.filter(x => x.connected).map((member) => ({
        id: member.id,
        username: member.username,
        avatarUrl: member.avatarUrl,
      })),
    };
  });
}


function getConnectedUsersList() {
    return Array.from(Users.values()).filter(user => {
        // Remove users disconnected for more than 1h
        return user.connected || (user.disconnectAt !== null && Date.now() - user.disconnectAt < 60 * 60 * 1000);
    }).map((user) => ({
        id: user.id,
        username: user.username,
        avatarUrl: user.avatarUrl,
        connected: user.connected,
        disconnectAt: user.disconnectAt
    })).sort((a, b) => {
        // order by connected status first, then by username
        if (a.connected && !b.connected) return -1;
        if (!a.connected && b.connected) return 1;
        return a.username.localeCompare(b.username);
    });
}

function removeUserEverywhere(user: SessionUser) {
  RM_Members.removeMemberFromAllRooms(user);
  Users.delete(user.id);
}

function buildLoginSuccess(user: SessionUser): LoginSuccessPayload {
  return {
    userId: user.id,
    username: user.username,
    rememberMe: user.rememberMe,
    expiresAt: user.expiresAt ? new Date(user.expiresAt).toISOString() : null,
  };
}

function isUsernameValid(username: string) {
  const usernameRegex = /^[a-zA-Z0-9_\.\- ]+$/;
  return usernameRegex.test(username);
}

function markHeartbeat(user: SessionUser) {
  const now = Date.now();
  user.connected = true;
  user.lastPingAt = now;
  user.lastSeenAt = now;
  user.logged = true;

  if (user.rememberMe) {
    user.expiresAt = now + SESSION_TTL_MS;
  }

  user.disconnectAt = null;
  Users.set(user.id, user);
}

setInterval(() => {
  const now = Date.now();

  Users.forEach((user) => {
    if (user.socketId && now - user.lastPingAt > HEARTBEAT_TIMEOUT_MS) {
      user.connected = false;
      user.disconnectAt = user.disconnectAt ?? now;
      user.logged = false;

      if (user.rememberMe) {
        user.disconnectAt = null;
      } else if (user.expiresAt === null) {
        user.expiresAt = now + TEMP_SESSION_GRACE_MS;
      }

      Users.set(user.id, user);
    }

    if (user.expiresAt !== null && user.expiresAt < now) {
      if (user.socketId) {
        io.to(user.socketId).emit('loggedOut', { reason: 'Session expired' });
      }
      removeUserEverywhere(user);
      RM_Members.removeMemberFromAllRooms(user);
    }
  });
}, 5 * 1000);

io.on('connection', (socket) => {
  console.log(`[socket][${socket.id}] Connected.`);

  function isConnected(): boolean {
    const user = getSocketUser(socket);
    if (!user) {
      return false;
    }
    return true;
  }

  function getRoomId(): string | null {
    const roomId = [...socket.rooms.values()].find((room) => room.startsWith('room-')) ?? null;
    return roomId ? roomId.replace('room-', '') : null;
  }

  socket.on('login', (datas: { username: string; rememberMe?: boolean }) => {
    let { username, rememberMe = false } = datas;

    rememberMe = true // TODO: force rememberMe to prevent infinite page reload

    if (!isUsernameValid(username)) {
      socket.emit('loginError', {
        message: 'Invalid username. Only alphanumeric characters, underscores, hyphens, dots, and spaces are allowed.',
      });
      return;
    }

    const user = createUser(username, socket.id, !!rememberMe);
    Users.set(user.id, user);
    socket.data.userId = user.id;

    socket.emit('loginSuccess', buildLoginSuccess(user));
    io.emit('roomList', getRoomList());
    io.emit('userList', getConnectedUsersList());
  });

  socket.on('resumeSession', (datas: ResumeSessionPayload) => {
    const user = getUserFromId(datas.userId);

    if (!user) {
      socket.emit('loggedOut', { reason: 'Session not found' });
      return;
    }

    if (user.expiresAt !== null && user.expiresAt < Date.now()) {
      removeUserEverywhere(user);
      socket.emit('loggedOut', { reason: 'Session expired' });
      return;
    }

    attachSocketToUser(user, socket.id);
    socket.data.userId = user.id;

    socket.emit('loginSuccess', buildLoginSuccess(user));
    io.emit('roomList', getRoomList());
    io.emit('userList', getConnectedUsersList());
  });

  socket.on('ping-ping', (datas: PingPayload = {}) => {
    const user = datas.userId ? getUserFromId(datas.userId) : getSocketUser(socket);

    if (!user) {
      socket.emit('loggedOut', { reason: 'User not found' });
      return;
    }

    markHeartbeat(user);

    socket.emit('ping-ping', {
      userId: user.id,
      serverTime: Date.now(),
    });
  });

  socket.on('disconnect', () => {
    console.log(`[socket][${socket.id}] Disconnected.`);

    const user = getUserFromSocketId(socket.id);
    if (user) {
      markUserDisconnected(user);

      if (!user.rememberMe) {
        RM_Members.removeMemberFromAllRooms(user);
      }
    }

    RM_Members.removeEveryMemberWithSocketId(socket.id);
    io.emit('roomList', getRoomList());
    io.emit('userList', getConnectedUsersList());
  });

  socket.on('message', ({ userId }: { userId: string; message: Types.Message }) => {
    const user = Users.get(userId);
    if (!user) {
      socket.emit('loggedOut', { reason: 'User not found' });
      return;
    }
  });

  socket.on('getRooms', () => {
    if (!isConnected()) return;
    socket.emit('roomList', getRoomList());
  });

  socket.on('getUsers', () => {
    if (!isConnected()) return;
    socket.emit('userList', getConnectedUsersList());
  });

  socket.on('joinRoom', (roomId: string) => {
    if (!isConnected()) return;

    const user = getSocketUser(socket);
    if (!user) return;

    for (const room of [...socket.rooms.values()]) {
      if (room !== socket.id) {
        socket.leave(room);
      }
    }

    if (!Rooms.has(roomId)) {
      socket.emit('error', { message: 'Room not found' });
      socket.emit('joinedRoom', null);
      io.emit('roomList', getRoomList());
      io.emit('userList', getConnectedUsersList());
      return;
    }

    RM_Members.removeMemberFromAllRooms(user);
    RM_Members.addMember(roomId, user);

    socket.join(`room-${roomId}`);
    socket.emit('joinedRoom', roomId);
    io.emit('roomList', getRoomList());
    io.emit('userList', getConnectedUsersList());
  });

  socket.on('getMembersInRoom', (roomId: string) => {
    if (!isConnected()) return;

    if (!Rooms.has(roomId)) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    socket.emit('membersInRoom', RM_Members.getMembers(roomId));
  });

  socket.on('sendMessage', (datas: { content: string; attachments: Array<Types.Attachment> }) => {
    if (!isConnected()) return;

    const user = getSocketUser(socket);
    if (!user) return;

    const message: Types.Message = {
      id: `${Date.now().toString().substring(5)}-${SF.Random.randHex(6)}`,
      content: datas.content,
      author: user.username,
      authorId: user.id,
      authorAvatarUrl: user.avatarUrl,
      timestamp: new Date().toISOString(),
      attachments: [],
    };

    const socketRoom = getRoomId();
    if (!socketRoom) {
      socket.emit('error', { message: 'Not in a room' });
      return;
    }

    RM_Messages.addMessage(socketRoom, message);

    const rooms = [...socket.rooms.values()].filter((room) => room.startsWith('room-'));
    rooms.forEach((room) => {
      io.to(room).emit('message', message);
    });
  });

  socket.on('getRoomHistory', (roomId: string) => {
    if (!isConnected()) return;
    socket.emit('roomHistory', RM_Messages.getMessages(roomId));
  });
});

app.get('/logout', (req, res) => {
  const userId = String(req.query.userId ?? '');
  const user = Users.get(userId);

  if (user) {
    if (user.socketId && io.sockets.sockets.has(user.socketId)) {
      io.to(user.socketId).emit('loggedOut', { reason: 'Manual logout' });
      io.sockets.sockets.get(user.socketId)?.disconnect(true);
    }

    RM_Members.removeMemberFromAllRooms(user);
    Users.delete(user.id);
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta http-equiv="refresh" content="0;url=/login" />
        <title>Logging out...</title>
      </head>
      <body>
        <script>
          try {
            localStorage.removeItem('quickord.userId');
            localStorage.removeItem('user');
            sessionStorage.removeItem('quickord.userId');
            sessionStorage.removeItem('user');
          } catch (e) {}
          window.location.replace('/login');
        </script>
      </body>
    </html>
  `);
});

app.get('*', (req, res) => {
  console.log(`Serving ${req.path}`);

  if (req.path.startsWith('/assets')) {
    const assetPath = path.resolve(path.join('./public/', req.path));

    if (fs.existsSync(assetPath)) {
      res.sendFile(assetPath);
    } else {
      res.status(404).send('File not found');
    }
    return;
  }

  const filePath = req.path === '/' ? '/index.html' : `${req.path}.html`;
  const fullPath = path.resolve(path.join('./public/', filePath));

  res.sendFile(fullPath, (err) => {
    if (err) {
      res.status(404).send('File not found');
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on: http://localhost:${PORT}`);
});