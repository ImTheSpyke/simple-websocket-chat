

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
    logged: boolean
    socketId: string
    id: string
    avatarUrl: string
    username: string
    expiresAt: number
    roles: Array<Role>
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
