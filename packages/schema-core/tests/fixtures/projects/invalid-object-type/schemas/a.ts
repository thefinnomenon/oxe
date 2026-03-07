import {
  defineSchema,
  enumType,
  field,
  objectType,
  role,
  table,
  type TableDeclaration,
} from '../../../../../src/index.js';

export const admin = role('admin');

export const DuplicateMembers = enumType('DuplicateMembers', ['a', 'a']);

export const Profile = objectType('Profile', {
  nickname: field.string().auth({ get: ['admin'] }),
  ownerId: field.id().owner(),
  externalId: field.string().unique(),
});

export const User = table('User', {
  fields: {
    id: field.id(),
    ownerOne: field.id().owner(),
    ownerTwo: field.id().owner(),
    Name: field.string(),
    name: field.string(),
    status: field.enum('MissingEnum'),
    profile: field.type('MissingType'),
    foreignId: field.id().references('MissingTable'),
    orphan: field.id().onDelete('cascade'),
  },
});

const WeirdTable = {
  ...table('WeirdTable', {
    fields: {
      value: field.string(),
    },
  }),
  metadata: {
    mediaType: 'image',
  },
};

const WeirdTableDeclaration = WeirdTable as unknown as TableDeclaration;

export default defineSchema({
  roles: [admin],
  enums: [DuplicateMembers],
  types: [Profile],
  tables: [User, WeirdTableDeclaration],
});
