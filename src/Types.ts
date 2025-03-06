

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
    username: string
    expiresAt: number
    roles: Array<Role>
    inRoomId: string // Id of the room the user is in. null if not in a room
}

export type Role = {
    name: string,
    color: string,
    id: string
}


export type Message = {
    content: string,
    author: string,
    authorId: string,
    isOwn: boolean,
    authorImageUrl: string,
    timestamp: number
    attachments: Array<Attachment>
}

export type Attachment = {
    type: 'image' | 'video' | 'audio' | 'file',
    url: string
}