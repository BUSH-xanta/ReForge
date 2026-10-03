import test from 'node:test';
import assert from 'node:assert/strict';
import { signS3, storageConfig } from '../src/storage.js';
test('SigV4 matches the published AWS S3 signing example', () => {
  const signed = signS3({ method: 'GET', url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'), payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    accessKey: 'AKIAIOSFODNN7EXAMPLE', secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1', now: new Date('2013-05-24T00:00:00Z'), extraHeaders: { range: 'bytes=0-9' } });
  assert.ok(signed.Authorization.endsWith('Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41'));
});
test('storage refuses insecure endpoints and SFTP path traversal', () => {
  assert.throws(() => storageConfig({ REFORGE_STORAGE: 's3', S3_ENDPOINT: 'http://insecure.example' }), /HTTPS/);
  assert.throws(() => storageConfig({ REFORGE_STORAGE: 's3', S3_BUCKET: 'valid-bucket' }), /credentials/);
  assert.equal(storageConfig({}).type, 'local');
});
