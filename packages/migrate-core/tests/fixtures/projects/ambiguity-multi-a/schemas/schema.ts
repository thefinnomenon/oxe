import { defineSchema, field, table } from '@oxe/schema-core';

export const User = table('User', {
  fields: {
    email: field.string().unique().email(),
    displayName: field.string().trim().minLength(2),
  },
});

export const Team = table('Team', {
  fields: {
    name: field.string().trim().minLength(2),
    ownerId: field.id().references(User).index(),
  },
});

export const Audit = table('Audit', {
  fields: {
    actorId: field.id().references(User).index(),
    action: field.string(),
  },
});

export const Profile = table('Profile', {
  fields: {
    fullName: field.string().trim().minLength(2),
    handle: field.string().trim().minLength(2),
    nickname: field.string().optional(),
  },
});

export default defineSchema({
  tables: [User, Team, Audit, Profile],
});
