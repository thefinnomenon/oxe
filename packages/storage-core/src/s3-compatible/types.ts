export interface S3CompatibleProviderConfig {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
  sessionToken?: string;
}
