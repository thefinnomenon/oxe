import { defineSchema, field, table } from '@oxe/schema-core';

export const Player = table('Player', {
  fields: {
    email: field.string().unique().email(),
    displayName: field.string().trim().minLength(2),
  },
});

export const Squad = table('Squad', {
  fields: {
    name: field.string().trim().minLength(2),
    ownerId: field.id().references(Player).index(),
  },
});

export const LogEntry = table('LogEntry', {
  fields: {
    actorId: field.id().references(Player).index(),
    action: field.string(),
  },
});

export const Profile = table('Profile', {
  fields: {
    displayName: field.string().trim().minLength(2),
    username: field.string().trim().minLength(2),
    nickname: field.string().optional(),
  },
});

export default defineSchema({
  tables: [Player, Squad, LogEntry, Profile],
});
