import { field } from '../../src/index.js';

const valid = field.string().auth({ get: 'public' }).index().trim().minLength(3).maxLength(100);

void valid;

// @ts-expect-error auth cannot be declared after transforms
field.string().trim().auth({ get: 'public' });

// @ts-expect-error DB directives cannot be declared after transforms
field.string().trim().index();

// @ts-expect-error transforms cannot be declared after validators
field.string().minLength(3).trim();
