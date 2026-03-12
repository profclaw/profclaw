import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  getSettings,
  updateSettings,
  resetSettings,
  UpdateSettingsSchema,
  getPluginHealth,
  togglePlugin,
} from '../settings/index.js';

const settings = new Hono();

async function parseJsonBody(c: Context): Promise<
  { ok: true; body: Record<string, unknown> } | { ok: false; response: Response }
> {
  try {
    const body = await c.req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return {
        ok: false,
        response: c.json({ error: 'Request body must be a JSON object' }, 400),
      };
    }

    return { ok: true, body: body as Record<string, unknown> };
  } catch {
    return {
      ok: false,
      response: c.json({ error: 'Invalid JSON body' }, 400),
    };
  }
}

// Get current settings (secrets masked)
settings.get('/', async (c) => {
  try {
    const currentSettings = await getSettings();
    return c.json({ settings: currentSettings });
  } catch (error) {
    console.error('[API] Error fetching settings:', error);
    return c.json(
      {
        error: 'Failed to fetch settings',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

// Update settings (partial update)
settings.patch('/', async (c) => {
  try {
    const parsedBody = await parseJsonBody(c);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }

    const parsed = UpdateSettingsSchema.safeParse(parsedBody.body);

    if (!parsed.success) {
      return c.json(
        {
          error: 'Validation failed',
          details: parsed.error.flatten(),
        },
        400
      );
    }

    const updated = await updateSettings(parsed.data);

    return c.json({
      message: 'Settings updated',
      settings: updated,
    });
  } catch (error) {
    console.error('[API] Error updating settings:', error);
    return c.json(
      {
        error: 'Failed to update settings',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

// Reset settings to defaults
settings.post('/reset', async (c) => {
  try {
    const resetResult = await resetSettings();
    return c.json({
      message: 'Settings reset to defaults',
      settings: resetResult,
    });
  } catch (error) {
    console.error('[API] Error resetting settings:', error);
    return c.json(
      {
        error: 'Failed to reset settings',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

// Get plugin health status
settings.get('/plugins/health', async (c) => {
  try {
    const health = await getPluginHealth();
    return c.json({ plugins: health });
  } catch (error) {
    console.error('[API] Error checking plugin health:', error);
    return c.json(
      {
        error: 'Failed to check plugin health',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

// Toggle plugin enabled/disabled
settings.post('/plugins/:id/toggle', async (c) => {
  try {
    const id = c.req.param('id');
    const parsedBody = await parseJsonBody(c);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }

    const enabled = Boolean(parsedBody.body.enabled);

    const result = await togglePlugin(id, enabled);

    return c.json({
      message: `Plugin ${id} ${enabled ? 'enabled' : 'disabled'}`,
      settings: result,
    });
  } catch (error) {
    console.error('[API] Error toggling plugin:', error);
    return c.json(
      {
        error: 'Failed to toggle plugin',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      error instanceof Error && error.message.includes('Unknown') ? 404 : 500
    );
  }
});

export { settings as settingsRoutes };
