// One operator-authorized staging drill. Trigger through Cloudflare's
// authenticated control API. No public execution endpoint and no cron.
import { WorkflowEntrypoint } from 'cloudflare:workers';
import { backupMedia } from './private-media-backup.mjs';

export class StagingMediaRecovery extends WorkflowEntrypoint {
  async run(_event, step) {
    return step.do('encrypted staging media export', {
      retries: { limit: 0, delay: '1 second' }, timeout: '1 minute',
    }, async () => {
      const expires = Number(this.env.BACKUP_EXPIRES_AT);
      if (!Number.isFinite(expires) || Date.now() > expires) throw new Error('Recovery authorization expired');
      if (this.env.BACKUP_ENVIRONMENT !== 'staging') throw new Error('Staging only');
      const completed = await this.env.BACKUP.get(`staging/${this.env.BACKUP_RUN_ID}/media-manifest.json`);
      if (completed) {
        const result = await completed.json();
        // Normalize download metadata for earlier encrypted artifacts. Byte
        // content stays identical; no plaintext is decrypted in this Worker.
        for (const item of result.objects) {
          if (!item.backup_key.startsWith(`staging/${this.env.BACKUP_RUN_ID}/objects/`)) throw new Error('Unexpected backup key');
          const object = await this.env.BACKUP.get(item.backup_key);
          if (!object || object.size > 20 * 1024 * 1024) throw new Error('Invalid encrypted artifact');
          await this.env.BACKUP.put(item.backup_key, await object.arrayBuffer(), {httpMetadata:{contentType:'application/octet-stream'}});
        }
        await this.env.BACKUP.put(`staging/${this.env.BACKUP_RUN_ID}/media-manifest.json`, JSON.stringify(result), {httpMetadata:{contentType:'application/octet-stream'}});
        return { already_completed: true, object_count: result.object_count, total_bytes: result.total_bytes };
      }
      const result = await backupMedia(this.env);
      return { object_count: result.object_count, total_bytes: result.total_bytes };
    });
  }
}

export default { fetch() { return new Response('Not found', { status: 404 }); } };
