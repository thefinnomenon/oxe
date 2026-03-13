BEGIN;

CREATE TYPE "enum_post_status" AS ENUM ('draft', 'published', 'archived');

CREATE TABLE "Comment" (
  "authorId" uuid NOT NULL,
  "body" text NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "id" uuid NOT NULL DEFAULT uuidv7(),
  "postId" uuid NOT NULL,
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "comment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Post" (
  "authorId" uuid NOT NULL,
  "body" text NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "id" uuid NOT NULL DEFAULT uuidv7(),
  "internalNotes" text NULL,
  "seo" jsonb NULL,
  "slug" text NOT NULL,
  "status" "enum_post_status" NOT NULL DEFAULT 'draft'::"enum_post_status",
  "tags" text[] NOT NULL,
  "title" text NOT NULL,
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "post_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "User" (
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "displayName" text NOT NULL,
  "email" text NOT NULL,
  "id" uuid NOT NULL DEFAULT uuidv7(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Post" ADD CONSTRAINT "post_slug_key" UNIQUE ("slug");

ALTER TABLE "User" ADD CONSTRAINT "user_email_key" UNIQUE ("email");

CREATE INDEX "comment_author_id_idx" ON "Comment" ("authorId");

CREATE INDEX "comment_post_id_idx" ON "Comment" ("postId");

CREATE INDEX "post_author_id_idx" ON "Post" ("authorId");

ALTER TABLE "Comment" ADD CONSTRAINT "comment_author_id_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id");

ALTER TABLE "Comment" ADD CONSTRAINT "comment_post_id_fkey" FOREIGN KEY ("postId") REFERENCES "Post" ("id");

ALTER TABLE "Post" ADD CONSTRAINT "post_author_id_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id");

COMMIT;
