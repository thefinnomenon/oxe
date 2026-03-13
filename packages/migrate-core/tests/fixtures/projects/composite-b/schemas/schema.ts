import { field, table } from '@oxe/schema-core';

export const Org = table('Org', {
  fields: {
    name: field.string(),
  },
});

export const User = table('User', {
  fields: {
    email: field.string().unique(),
  },
});

export const Membership = table('Membership', {
  fields: {
    orgId: field.id().references(Org).index(),
    userId: field.id().references(User).index(),
    role: field.string().default('member'),
  },
  indexes: [['orgId', 'userId']],
  unique: [['orgId', 'role']],
});
