/**
 * Storage Section
 *
 * Configure database, backup/restore, and cloud sync settings.
 */

import type { RefObject, ChangeEvent } from 'react';
import { Download, Upload, Loader2, Server } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SettingsCard } from '../components/SettingsCard';

interface StorageSectionProps {
  isExporting: boolean;
  isImporting: boolean;
  handleExport: () => Promise<void>;
  handleImport: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  fileInputRef: RefObject<HTMLInputElement | null>;
}

export function StorageSection({
  isExporting,
  isImporting,
  handleExport,
  handleImport,
  fileInputRef,
}: StorageSectionProps) {
  return (
    <>
      <SettingsCard title="Database" description="Local storage configuration">
        <div className="flex items-center justify-between p-3 rounded-xl bg-muted/50">
          <div>
            <p className="text-sm font-medium">Local SQLite</p>
            <p className="text-xs text-muted-foreground">/data/profclaw.db</p>
          </div>
          <span className="text-xs font-bold px-2 py-1 rounded-full bg-green-500/10 text-green-500">
            CONNECTED
          </span>
        </div>
      </SettingsCard>

      <SettingsCard
        title="Backup & Restore"
        description="Export or import your data"
      >
        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={handleExport}
            disabled={isExporting}
            className="flex-1 rounded-xl"
          >
            {isExporting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Download className="h-4 w-4 mr-2" />
            )}
            Export Tasks
          </Button>
          <Button
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={isImporting}
            className="flex-1 rounded-xl"
          >
            {isImporting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Upload className="h-4 w-4 mr-2" />
            )}
            Import Tasks
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleImport}
            className="hidden"
          />
        </div>
      </SettingsCard>

      <SettingsCard title="Cloud Sync" description="Sync data across devices">
        <Button variant="outline" className="w-full rounded-xl" disabled>
          <Server className="h-4 w-4 mr-2" />
          Connect to Turso Cloud (Coming Soon)
        </Button>
      </SettingsCard>
    </>
  );
}
