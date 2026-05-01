

export type Room = {
    "id": string,
    "name": string,
    "isClosed": boolean,
    "canSeeHistory": boolean,
    "ownerID": string,
    "deletable": boolean,
    "allowVisitors": boolean,
    "whitelist": string[],
    "whitelistEnabled": boolean,
    "blacklist": string[],
    "blacklistEnabled": boolean,
    "expires": boolean,
    "expiresAt": number,
}



export type User = {
    id: string;
    username: string;
    avatarUrl: string;
    logged: boolean;
    rememberMe: boolean;
    roles: Array<Role>;
    connected: boolean;
    expiresAt: number | null;
    disconnectAt: number | null;
    lastSeenAt: number;
    lastPingAt: number;
    socketId: string | null;
}

export type Role = {
    name: string,
    color: string,
    id: string
}


export type Message = {
    id: string,
    content: string,
    author: string,
    authorId: string,
    authorAvatarUrl: string,
    timestamp: string // ISO string
    attachments: Array<Attachment>
}

export type Attachment = {
    type: 'image' | 'video' | 'audio' | 'file',
    url: string,
    bufferData: Buffer
    name: string
}
