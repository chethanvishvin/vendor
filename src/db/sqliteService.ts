import { open, DB } from '@op-engineering/op-sqlite';
import { Platform } from 'react-native';
import { StationItem, VendorFileType, DEFAULT_FILE_TYPES } from '../types';
import { Asset } from 'react-native-image-picker';
import { apiService } from '../api/apiService';

const DB_NAME = 'vendor_tracking.sqlite';

let dbInstance: DB | null = null;
let isInitializing = false;

/**
 * Get or initialize the SQLite database connection
 */
export const getDatabase = async (): Promise<DB> => {
  if (dbInstance) {
    return dbInstance;
  }

  if (isInitializing) {
    // Wait briefly if another call is currently initializing
    await new Promise(resolve => setTimeout(() => resolve(undefined), 100));
    if (dbInstance) return dbInstance;
  }

  isInitializing = true;
  try {
    const db = open({ name: DB_NAME });

    // Create tables for pending stations and sync metadata
    await db.execute(`
      CREATE TABLE IF NOT EXISTS pending_stations (
        ExcelDataId INTEGER PRIMARY KEY,
        VendorStationAssignmentId INTEGER,
        Station TEXT,
        Taluk TEXT,
        VoltageClass TEXT,
        PinCode TEXT,
        InChangreAEJEname TEXT,
        InChangreAEJEcontactNumber TEXT,
        StationAddress TEXT,
        SwitchSerialNumber TEXT,
        ResilientSerialNumber TEXT,
        Zone TEXT,
        Circle TEXT,
        Division TEXT,
        VendorId INTEGER,
        RouteStationStatusId INTEGER,
        jsonData TEXT,
        syncedAt INTEGER
      );
    `);

    try {
      await db.execute('ALTER TABLE pending_stations ADD COLUMN RouteStationStatusId INTEGER;');
    } catch (_) {}

    await db.execute(`
      CREATE TABLE IF NOT EXISTS sync_meta (
        key TEXT PRIMARY KEY,
        value TEXT,
        updatedAt INTEGER
      );
    `);

    // Table for storing captured proof photos per station and field
    await db.execute(`
      CREATE TABLE IF NOT EXISTS station_proof_drafts (
        excelDataId INTEGER NOT NULL,
        vendorId INTEGER NOT NULL,
        fileTypeId INTEGER NOT NULL,
        fileTypeName TEXT,
        photoUri TEXT NOT NULL,
        fileName TEXT,
        fileType TEXT,
        fileSize INTEGER,
        geoTagJson TEXT,
        switchSerialNumber TEXT,
        resilientSerialNumber TEXT,
        switchFirmwareNumber TEXT,
        updatedAt INTEGER,
        PRIMARY KEY (excelDataId, vendorId, fileTypeId)
      );
    `);

    // Ensure geoTagJson, hardware, and multi-photo columns exist in existing tables if created previously
    try {
      await db.execute('ALTER TABLE station_proof_drafts ADD COLUMN geoTagJson TEXT;');
    } catch (_) {}
    try {
      await db.execute('ALTER TABLE station_proof_drafts ADD COLUMN switchSerialNumber TEXT;');
    } catch (_) {}
    try {
      await db.execute('ALTER TABLE station_proof_drafts ADD COLUMN resilientSerialNumber TEXT;');
    } catch (_) {}
    try {
      await db.execute('ALTER TABLE station_proof_drafts ADD COLUMN switchFirmwareNumber TEXT;');
    } catch (_) {}
    try {
      await db.execute('ALTER TABLE station_proof_drafts ADD COLUMN photosJson TEXT;');
    } catch (_) {}

    // Table for storing captured remarks draft per station
    await db.execute(`
      CREATE TABLE IF NOT EXISTS station_remarks_draft (
        excelDataId INTEGER NOT NULL,
        vendorId INTEGER NOT NULL,
        remarks TEXT,
        updatedAt INTEGER,
        PRIMARY KEY (excelDataId, vendorId)
      );
    `);

    // Table for storing captured hardware serial numbers & firmware draft per station
    await db.execute(`
      CREATE TABLE IF NOT EXISTS station_hardware_draft (
        excelDataId INTEGER NOT NULL,
        vendorId INTEGER NOT NULL,
        switchSerialNumber TEXT,
        resilientSerialNumber TEXT,
        switchFirmwareNumber TEXT,
        updatedAt INTEGER,
        PRIMARY KEY (excelDataId, vendorId)
      );
    `);

    // Table for caching dropdown file types offline
    await db.execute(`
      CREATE TABLE IF NOT EXISTS cached_file_types (
        VendorFileTypeId INTEGER PRIMARY KEY,
        VendorFileTypeName TEXT,
        flagId INTEGER,
        jsonData TEXT,
        updatedAt INTEGER
      );
    `);

    // Table for storing full pending submissions when offline
    await db.execute(`
      CREATE TABLE IF NOT EXISTS offline_submissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        excelDataId INTEGER NOT NULL,
        stationName TEXT,
        voltageClass TEXT,
        vendorId INTEGER NOT NULL,
        vendorWorkerId INTEGER,
        remarks TEXT,
        createdByUserName TEXT,
        flagId TEXT DEFAULT '2',
        fileTypeIds TEXT,
        filesJson TEXT,
        switchSerialNumber TEXT,
        resilientSerialNumber TEXT,
        switchFirmwareNumber TEXT,
        routeStationStatusId INTEGER,
        status TEXT DEFAULT 'pending',
        errorMessage TEXT,
        createdAt INTEGER,
        updatedAt INTEGER
      );
    `);

    // Migration for offline_submissions hardware, worker, and route station status columns
    try {
      await db.execute('ALTER TABLE offline_submissions ADD COLUMN vendorWorkerId INTEGER;');
    } catch (_) {}
    try {
      await db.execute('ALTER TABLE offline_submissions ADD COLUMN switchSerialNumber TEXT;');
    } catch (_) {}
    try {
      await db.execute('ALTER TABLE offline_submissions ADD COLUMN resilientSerialNumber TEXT;');
    } catch (_) {}
    try {
      await db.execute('ALTER TABLE offline_submissions ADD COLUMN switchFirmwareNumber TEXT;');
    } catch (_) {}
    try {
      await db.execute('ALTER TABLE offline_submissions ADD COLUMN routeStationStatusId INTEGER;');
    } catch (_) {}
    try {
      await db.execute('ALTER TABLE offline_submissions ADD COLUMN workerStationAssignmentId INTEGER;');
    } catch (_) {}
    try {
      await db.execute('ALTER TABLE offline_submissions ADD COLUMN isWorkerSubmission INTEGER DEFAULT 0;');
    } catch (_) {}

    // Deduplication cleanup: keep only the latest record for each (excelDataId, vendorId)
    try {
      await db.execute(`
        DELETE FROM offline_submissions 
        WHERE id NOT IN (
          SELECT MAX(id) FROM offline_submissions GROUP BY excelDataId, vendorId
        );
      `);
      await db.execute(
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_offline_unique_station ON offline_submissions(excelDataId, vendorId);',
      );
    } catch (cleanErr) {
      console.warn('[SQLite] Deduplication index check notice:', cleanErr);
    }

    dbInstance = db;
    return db;
  } catch (error) {
    console.error('Failed to initialize SQLite database:', error);
    throw error;
  } finally {
    isInitializing = false;
  }
};

/**
 * Synchronize pending stations into the SQLite database in the background.
 * Uses a transaction to cleanly replace existing records for this vendor.
 */
export const syncPendingStationsToSQLite = async (
  vendorId: number,
  stations: StationItem[],
): Promise<{ success: boolean; count: number; error?: string }> => {
  try {
    const db = await getDatabase();

    // Use transaction for atomic, super-fast background write
    await db.transaction(async tx => {
      // 1. Clear previous pending stations for this vendor
      await tx.execute('DELETE FROM pending_stations WHERE VendorId = ?', [vendorId]);

      // 2. Insert new pending stations
      for (const station of stations) {
        await tx.execute(
          `INSERT OR REPLACE INTO pending_stations (
            ExcelDataId,
            VendorStationAssignmentId,
            Station,
            Taluk,
            VoltageClass,
            PinCode,
            InChangreAEJEname,
            InChangreAEJEcontactNumber,
            StationAddress,
            SwitchSerialNumber,
            ResilientSerialNumber,
            Zone,
            Circle,
            Division,
            VendorId,
            RouteStationStatusId,
            jsonData,
            syncedAt
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            station.ExcelDataId,
            station.VendorStationAssignmentId,
            station.Station || '',
            station.Taluk || '',
            station.VoltageClass || '',
            station.PinCode || '',
            station.InChangreAEJEname || '',
            (station as any).ContactNumber || (station as any).InChangreAEJEcontactNumber || '',
            (station as any).SubStationAddress || (station as any).StationAddress || '',
            station.SwitchSerialNumber || '',
            station.ResilientSerialNumber || '',
            station.Zone || '',
            station.Circle || '',
            station.Division || '',
            vendorId,
            station.RouteStationStatusId || 0,
            JSON.stringify(station),
            Date.now(),
          ],
        );
      }

      // 3. Record sync metadata
      const metaValue = JSON.stringify({
        vendorId,
        count: stations.length,
        timestamp: Date.now(),
      });

      await tx.execute(
        `INSERT OR REPLACE INTO sync_meta (key, value, updatedAt) VALUES (?, ?, ?)`,
        ['last_pending_sync', metaValue, Date.now()],
      );
    });

    console.log(`[SQLite] Successfully synced ${stations.length} pending stations to SQLite`);
    return { success: true, count: stations.length };
  } catch (error: any) {
    console.error('[SQLite] Error syncing pending stations:', error);
    return { success: false, count: 0, error: error?.message || 'Unknown database error' };
  }
};

/**
 * Retrieve all pending stations stored in SQLite for a specific vendor
 */
export const getPendingStationsFromSQLite = async (
  vendorId?: number,
): Promise<StationItem[]> => {
  try {
    const db = await getDatabase();
    let result: any = null;
    if (vendorId && vendorId > 0) {
      result = await db.execute(
        'SELECT jsonData FROM pending_stations WHERE VendorId = ? ORDER BY Station ASC',
        [vendorId],
      );
    }

    // Fallback: If no stations found for specific vendorId (e.g. worker login or vendorId mismatch),
    // retrieve all pending stations in SQLite so the offline view is never blank
    if (!result || !result.rows || result.rows.length === 0) {
      result = await db.execute(
        'SELECT jsonData FROM pending_stations ORDER BY Station ASC',
      );
    }

    const list: StationItem[] = [];
    if (result && result.rows) {
      for (const row of result.rows) {
        if (row.jsonData && typeof row.jsonData === 'string') {
          try {
            list.push(JSON.parse(row.jsonData));
          } catch (_) {}
        }
      }
    }
    return list;
  } catch (error) {
    console.error('[SQLite] Error reading pending stations from SQLite:', error);
    return [];
  }
};

/**
 * Retrieve latest sync metadata
 */
export const getLastSyncMetadata = async (): Promise<{
  count: number;
  timestamp: number;
} | null> => {
  try {
    const db = await getDatabase();
    const result = await db.execute(
      'SELECT value FROM sync_meta WHERE key = ?',
      ['last_pending_sync'],
    );

    if (result && result.rows && result.rows.length > 0) {
      const row = result.rows[0];
      if (row.value && typeof row.value === 'string') {
        const parsed = JSON.parse(row.value);
        return {
          count: parsed.count || 0,
          timestamp: parsed.timestamp || 0,
        };
      }
    }
    return null;
  } catch (error) {
    console.error('[SQLite] Error reading sync metadata:', error);
    return null;
  }
};

/**
 * Ensures an image URI has a valid scheme (file://, content://, http://, https://)
 * so that React Native Image and Fresco can display local Android file paths.
 */
export const ensureFileUri = (uri?: string | null): string => {
  if (!uri) return '';
  const trimmed = uri.trim();
  if (
    trimmed.startsWith('file://') ||
    trimmed.startsWith('content://') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('data:')
  ) {
    return trimmed;
  }
  return `file://${trimmed}`;
};

/**
 * Save or replace captured draft photos immediately in SQLite (supports up to 5 photos per category)
 */
export const saveDraftPhoto = async (
  excelDataId: number,
  vendorId: number,
  fileTypeId: number,
  fileTypeName: string,
  assetOrAssets:
    | (Asset & { geoTag?: any; taggedUri?: string })
    | (Asset & { geoTag?: any; taggedUri?: string })[],
  hardwareDetails?: {
    switchSerialNumber?: string;
    resilientSerialNumber?: string;
    switchFirmwareNumber?: string;
  },
): Promise<boolean> => {
  try {
    const db = await getDatabase();
    const assets: (Asset & { geoTag?: any; taggedUri?: string })[] = Array.isArray(assetOrAssets)
      ? assetOrAssets
      : [assetOrAssets];

    if (assets.length === 0) {
      return removeDraftPhoto(excelDataId, vendorId, fileTypeId);
    }

    const firstAsset = assets[0];
    const safeUri = ensureFileUri(firstAsset.taggedUri || firstAsset.uri);
    const geoTagJson = firstAsset.geoTag ? JSON.stringify(firstAsset.geoTag) : null;
    const photosJson = JSON.stringify(assets);

    let finalSw = hardwareDetails?.switchSerialNumber ?? null;
    let finalRes = hardwareDetails?.resilientSerialNumber ?? null;
    let finalFw = hardwareDetails?.switchFirmwareNumber ?? null;

    if (finalSw === null || finalRes === null || finalFw === null) {
      const prev = await db.execute(
        'SELECT switchSerialNumber, resilientSerialNumber, switchFirmwareNumber FROM station_proof_drafts WHERE excelDataId = ? AND vendorId = ? LIMIT 1',
        [excelDataId, vendorId],
      );
      if (prev && prev.rows && prev.rows.length > 0) {
        if (finalSw === null) finalSw = (prev.rows[0].switchSerialNumber as string) || '';
        if (finalRes === null) finalRes = (prev.rows[0].resilientSerialNumber as string) || '';
        if (finalFw === null) finalFw = (prev.rows[0].switchFirmwareNumber as string) || '';
      }
    }

    await db.execute(
      `INSERT OR REPLACE INTO station_proof_drafts (
        excelDataId,
        vendorId,
        fileTypeId,
        fileTypeName,
        photoUri,
        fileName,
        fileType,
        fileSize,
        geoTagJson,
        switchSerialNumber,
        resilientSerialNumber,
        switchFirmwareNumber,
        photosJson,
        updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        excelDataId,
        vendorId,
        fileTypeId,
        fileTypeName || '',
        safeUri,
        firstAsset.fileName || `proof_${fileTypeId}.jpg`,
        firstAsset.type || 'image/jpeg',
        firstAsset.fileSize || 0,
        geoTagJson,
        finalSw || '',
        finalRes || '',
        finalFw || '',
        photosJson,
        Date.now(),
      ],
    );
    console.log(`[SQLite] Saved photo draft (${assets.length} photos) for station ${excelDataId}, fileType ${fileTypeId}`);
    return true;
  } catch (error) {
    console.error('[SQLite] Error saving draft photo:', error);
    return false;
  }
};

/**
 * Save or update hardware serial numbers & firmware draft immediately in SQLite
 */
export const saveDraftHardwareDetails = async (
  excelDataId: number,
  vendorId: number,
  details: {
    switchSerialNumber?: string;
    resilientSerialNumber?: string;
    switchFirmwareNumber?: string;
  },
): Promise<boolean> => {
  try {
    const db = await getDatabase();
    const now = Date.now();

    // 1. Fetch current draft values so undefined fields aren't wiped
    let prevSw = '';
    let prevRes = '';
    let prevFw = '';

    try {
      const existingDraft = await db.execute(
        'SELECT switchSerialNumber, resilientSerialNumber, switchFirmwareNumber FROM station_hardware_draft WHERE excelDataId = ? AND vendorId = ?',
        [excelDataId, vendorId],
      );
      if (existingDraft && existingDraft.rows && existingDraft.rows.length > 0) {
        prevSw = (existingDraft.rows[0].switchSerialNumber as string) || '';
        prevRes = (existingDraft.rows[0].resilientSerialNumber as string) || '';
        prevFw = (existingDraft.rows[0].switchFirmwareNumber as string) || '';
      }
    } catch (_) {}

    if (!prevSw || !prevRes || !prevFw) {
      try {
        const prevPhotos = await db.execute(
          'SELECT switchSerialNumber, resilientSerialNumber, switchFirmwareNumber FROM station_proof_drafts WHERE excelDataId = ? AND vendorId = ? LIMIT 1',
          [excelDataId, vendorId],
        );
        if (prevPhotos && prevPhotos.rows && prevPhotos.rows.length > 0) {
          if (!prevSw) prevSw = (prevPhotos.rows[0].switchSerialNumber as string) || '';
          if (!prevRes) prevRes = (prevPhotos.rows[0].resilientSerialNumber as string) || '';
          if (!prevFw) prevFw = (prevPhotos.rows[0].switchFirmwareNumber as string) || '';
        }
      } catch (_) {}
    }

    const sw = details.switchSerialNumber !== undefined ? details.switchSerialNumber : prevSw;
    const res = details.resilientSerialNumber !== undefined ? details.resilientSerialNumber : prevRes;
    const fw = details.switchFirmwareNumber !== undefined ? details.switchFirmwareNumber : prevFw;

    // 2. Persist immediately into dedicated station_hardware_draft table
    await db.execute(
      `INSERT OR REPLACE INTO station_hardware_draft (
        excelDataId,
        vendorId,
        switchSerialNumber,
        resilientSerialNumber,
        switchFirmwareNumber,
        updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [excelDataId, vendorId, sw, res, fw, now],
    );

    // 3. Keep station_proof_drafts rows in sync
    await db.execute(
      'UPDATE station_proof_drafts SET switchSerialNumber = ?, resilientSerialNumber = ?, switchFirmwareNumber = ?, updatedAt = ? WHERE excelDataId = ? AND vendorId = ?',
      [sw, res, fw, now, excelDataId, vendorId],
    );

    // 4. Update pending_stations table for immediate offline visibility
    try {
      await db.execute(
        'UPDATE pending_stations SET SwitchSerialNumber = ?, ResilientSerialNumber = ? WHERE ExcelDataId = ?',
        [sw, res, excelDataId],
      );
    } catch (_) {}

    console.log(`[SQLite] Cached hardware serials for station ${excelDataId}: Switch=${sw}, Resilient=${res}, FW=${fw}`);
    return true;
  } catch (error) {
    console.error('[SQLite] Error saving draft hardware details:', error);
    return false;
  }
};

/**
 * Remove a specific draft photo from SQLite
 */
export const removeDraftPhoto = async (
  excelDataId: number,
  vendorId: number,
  fileTypeId: number,
): Promise<boolean> => {
  try {
    const db = await getDatabase();
    await db.execute(
      'DELETE FROM station_proof_drafts WHERE excelDataId = ? AND vendorId = ? AND fileTypeId = ?',
      [excelDataId, vendorId, fileTypeId],
    );
    return true;
  } catch (error) {
    console.error('[SQLite] Error removing draft photo:', error);
    return false;
  }
};

/**
 * Save or update station remarks immediately in SQLite
 */
export const saveDraftRemarks = async (
  excelDataId: number,
  vendorId: number,
  remarks: string,
): Promise<boolean> => {
  try {
    const db = await getDatabase();
    await db.execute(
      `INSERT OR REPLACE INTO station_remarks_draft (
        excelDataId,
        vendorId,
        remarks,
        updatedAt
      ) VALUES (?, ?, ?, ?)`,
      [excelDataId, vendorId, remarks, Date.now()],
    );
    return true;
  } catch (error) {
    console.error('[SQLite] Error saving draft remarks:', error);
    return false;
  }
};

/**
 * Retrieve all saved draft photos, hardware serials, and remarks for a station
 */
export const getStationProofDraft = async (
  excelDataId: number,
  vendorId: number,
): Promise<{
  photos: { [fileTypeId: number]: (Asset & { geoTag?: any; taggedUri?: string })[] };
  remarks: string;
  switchSerialNumber: string;
  resilientSerialNumber: string;
  switchFirmwareNumber: string;
  hasDraft: boolean;
}> => {
  try {
    const db = await getDatabase();

    // 1. Get hardware details from dedicated station_hardware_draft table first
    let switchSerialNumber = '';
    let resilientSerialNumber = '';
    let switchFirmwareNumber = '';

    try {
      const hwResult = await db.execute(
        'SELECT switchSerialNumber, resilientSerialNumber, switchFirmwareNumber FROM station_hardware_draft WHERE excelDataId = ? AND vendorId = ?',
        [excelDataId, vendorId],
      );
      if (hwResult && hwResult.rows && hwResult.rows.length > 0) {
        switchSerialNumber = (hwResult.rows[0].switchSerialNumber as string) || '';
        resilientSerialNumber = (hwResult.rows[0].resilientSerialNumber as string) || '';
        switchFirmwareNumber = (hwResult.rows[0].switchFirmwareNumber as string) || '';
      }
    } catch (_) {}

    // 2. Get photos and hardware details from photo drafts
    const photoResult = await db.execute(
      'SELECT fileTypeId, fileTypeName, photoUri, fileName, fileType, fileSize, geoTagJson, switchSerialNumber, resilientSerialNumber, switchFirmwareNumber, photosJson FROM station_proof_drafts WHERE excelDataId = ? AND vendorId = ?',
      [excelDataId, vendorId],
    );

    const photos: { [fileTypeId: number]: (Asset & { geoTag?: any; taggedUri?: string })[] } = {};

    if (photoResult && photoResult.rows) {
      for (const row of photoResult.rows) {
        if (!switchSerialNumber && row.switchSerialNumber) {
          switchSerialNumber = String(row.switchSerialNumber);
        }
        if (!resilientSerialNumber && row.resilientSerialNumber) {
          resilientSerialNumber = String(row.resilientSerialNumber);
        }
        if (!switchFirmwareNumber && row.switchFirmwareNumber) {
          switchFirmwareNumber = String(row.switchFirmwareNumber);
        }

        const fid = Number(row.fileTypeId);
        if (fid > 0) {
          let parsedAssets: (Asset & { geoTag?: any; taggedUri?: string })[] = [];

          // Try parsing multiple photos array from photosJson column
          if (row.photosJson && typeof row.photosJson === 'string') {
            try {
              const parsed = JSON.parse(row.photosJson);
              if (Array.isArray(parsed) && parsed.length > 0) {
                parsedAssets = parsed.map(item => ({
                  ...item,
                  uri: ensureFileUri(item.taggedUri || item.uri),
                  taggedUri: item.taggedUri ? ensureFileUri(item.taggedUri) : ensureFileUri(item.uri),
                }));
              }
            } catch (_) {}
          }

          // Fallback to legacy single photoUri if photosJson was not present or empty
          if (parsedAssets.length === 0 && row.photoUri) {
            let geoTag = undefined;
            if (row.geoTagJson && typeof row.geoTagJson === 'string') {
              try {
                geoTag = JSON.parse(row.geoTagJson);
              } catch (_) {}
            }
            const safeUri = ensureFileUri(row.photoUri as string);
            parsedAssets = [
              {
                uri: safeUri,
                taggedUri: safeUri,
                geoTag,
                fileName: (row.fileName as string) || `proof_${fid}.jpg`,
                type: (row.fileType as string) || 'image/jpeg',
                fileSize: Number(row.fileSize || 0),
              },
            ];
          }

          if (parsedAssets.length > 0) {
            photos[fid] = parsedAssets;
          }
        }
      }
    }

    // 3. Fallback to pending_stations if hardware serials are not in drafts
    if (!switchSerialNumber || !resilientSerialNumber) {
      try {
        const psRes = await db.execute(
          'SELECT SwitchSerialNumber, ResilientSerialNumber FROM pending_stations WHERE ExcelDataId = ? LIMIT 1',
          [excelDataId],
        );
        if (psRes && psRes.rows && psRes.rows.length > 0) {
          if (!switchSerialNumber && psRes.rows[0].SwitchSerialNumber) {
            const sw = String(psRes.rows[0].SwitchSerialNumber).trim();
            if (sw && sw !== 'N/A' && sw !== 'NA') switchSerialNumber = sw;
          }
          if (!resilientSerialNumber && psRes.rows[0].ResilientSerialNumber) {
            const res = String(psRes.rows[0].ResilientSerialNumber).trim();
            if (res && res !== 'N/A' && res !== 'NA') resilientSerialNumber = res;
          }
        }
      } catch (_) {}
    }

    // 4. Get remarks
    const remarksResult = await db.execute(
      'SELECT remarks FROM station_remarks_draft WHERE excelDataId = ? AND vendorId = ?',
      [excelDataId, vendorId],
    );

    let remarks = '';
    if (remarksResult && remarksResult.rows && remarksResult.rows.length > 0) {
      remarks = (remarksResult.rows[0].remarks as string) || '';
    }

    const hasDraft =
      Object.keys(photos).length > 0 ||
      remarks.trim().length > 0 ||
      switchSerialNumber.trim().length > 0 ||
      resilientSerialNumber.trim().length > 0 ||
      switchFirmwareNumber.trim().length > 0;

    return {
      photos,
      remarks,
      switchSerialNumber,
      resilientSerialNumber,
      switchFirmwareNumber,
      hasDraft,
    };
  } catch (error) {
    console.error('[SQLite] Error retrieving station proof draft:', error);
    return {
      photos: {},
      remarks: '',
      switchSerialNumber: '',
      resilientSerialNumber: '',
      switchFirmwareNumber: '',
      hasDraft: false,
    };
  }
};

/**
 * Clear draft photos, hardware details, and remarks for a station upon successful submission
 */
export const clearStationProofDraft = async (
  excelDataId: number,
  vendorId: number,
): Promise<boolean> => {
  try {
    const db = await getDatabase();
    await db.transaction(async tx => {
      await tx.execute(
        'DELETE FROM station_proof_drafts WHERE excelDataId = ? AND vendorId = ?',
        [excelDataId, vendorId],
      );
      await tx.execute(
        'DELETE FROM station_hardware_draft WHERE excelDataId = ? AND vendorId = ?',
        [excelDataId, vendorId],
      );
      await tx.execute(
        'DELETE FROM station_remarks_draft WHERE excelDataId = ? AND vendorId = ?',
        [excelDataId, vendorId],
      );
    });
    console.log(`[SQLite] Cleared proof drafts for station ${excelDataId}`);
    return true;
  } catch (error) {
    console.error('[SQLite] Error clearing station proof draft:', error);
    return false;
  }
};

/**
 * Cache dropdown file types into SQLite for offline rendering
 */
export const saveCachedFileTypes = async (
  fileTypes: VendorFileType[],
): Promise<void> => {
  if (!fileTypes || fileTypes.length === 0) return;
  try {
    const db = await getDatabase();
    await db.transaction(async tx => {
      for (const item of fileTypes) {
        await tx.execute(
          `INSERT OR REPLACE INTO cached_file_types (
            VendorFileTypeId,
            VendorFileTypeName,
            flagId,
            jsonData,
            updatedAt
          ) VALUES (?, ?, ?, ?, ?)`,
          [
            item.VendorFileTypeId,
            item.VendorFileTypeName,
            (item as any).flagId || 2,
            JSON.stringify(item),
            Date.now(),
          ],
        );
      }
    });
  } catch (error) {
    console.error('[SQLite] Error caching file types:', error);
  }
};

/**
 * Retrieve cached dropdown file types from SQLite
 */
export const getCachedFileTypes = async (): Promise<VendorFileType[]> => {
  try {
    const db = await getDatabase();
    const result = await db.execute(
      'SELECT jsonData FROM cached_file_types ORDER BY VendorFileTypeId ASC',
    );
    const list: VendorFileType[] = [];
    if (result && result.rows) {
      for (const row of result.rows) {
        if (row.jsonData && typeof row.jsonData === 'string') {
          try {
            list.push(JSON.parse(row.jsonData));
          } catch (_) {}
        }
      }
    }
    if (list.length > 0) {
      return list;
    }
  } catch (error) {
    console.error('[SQLite] Error reading cached file types:', error);
  }
  return DEFAULT_FILE_TYPES;
};

export interface OfflineSubmissionFile {
  uri: string;
  name: string;
  type: string;
  fileTypeId: number;
  fileTypeName?: string;
  size?: number;
}

export interface OfflineSubmissionItem {
  id: number;
  excelDataId: number;
  stationName: string;
  voltageClass: string;
  vendorId: number;
  vendorWorkerId?: number;
  workerStationAssignmentId?: number;
  isWorkerSubmission?: boolean;
  remarks: string;
  createdByUserName: string;
  flagId: string;
  fileTypeIds: number[];
  files: OfflineSubmissionFile[];
  switchSerialNumber?: string;
  resilientSerialNumber?: string;
  switchFirmwareNumber?: string;
  routeStationStatusId?: number;
  status: 'pending' | 'syncing' | 'failed';
  errorMessage?: string;
  createdAt: number;
  updatedAt: number;
}

type OfflineQueueListener = (count: number) => void;
const queueListeners = new Set<OfflineQueueListener>();

/**
 * Register a listener that gets notified whenever the offline submission queue changes (added, removed, or synced)
 */
export const addOfflineQueueListener = (listener: OfflineQueueListener): (() => void) => {
  queueListeners.add(listener);
  getOfflineSubmissionsCount().then(c => {
    try {
      listener(c);
    } catch (_) {}
  });
  return () => {
    queueListeners.delete(listener);
  };
};

/**
 * Notify all registered queue listeners of the latest count
 */
export const notifyOfflineQueueChanged = async (vendorId?: number) => {
  try {
    const count = await getOfflineSubmissionsCount(vendorId);
    queueListeners.forEach(listener => {
      try {
        listener(count);
      } catch (err) {
        console.warn('Queue listener error:', err);
      }
    });
  } catch (_) {}
};

/**
 * Queue a full installation submission row into SQLite when offline
 */
export const queueOfflineSubmission = async (params: {
  excelDataId: number;
  stationName: string;
  voltageClass: string;
  vendorId: number;
  vendorWorkerId?: number;
  workerStationAssignmentId?: number;
  isWorkerSubmission?: boolean;
  remarks: string;
  createdByUserName: string;
  flagId?: string;
  fileTypeIds: number[];
  files: OfflineSubmissionFile[];
  switchSerialNumber?: string;
  resilientSerialNumber?: string;
  switchFirmwareNumber?: string;
  routeStationStatusId?: number;
}): Promise<{ success: boolean; id?: number; error?: string }> => {
  try {
    const db = await getDatabase();
    const now = Date.now();

    // Prevent duplicate entries: replace any prior pending/failed submission for this station
    try {
      await db.execute(
        'DELETE FROM offline_submissions WHERE excelDataId = ? AND vendorId = ?',
        [params.excelDataId, params.vendorId],
      );
    } catch (_) {}

    const result = await db.execute(
      `INSERT INTO offline_submissions (
        excelDataId,
        stationName,
        voltageClass,
        vendorId,
        vendorWorkerId,
        workerStationAssignmentId,
        isWorkerSubmission,
        remarks,
        createdByUserName,
        flagId,
        fileTypeIds,
        filesJson,
        switchSerialNumber,
        resilientSerialNumber,
        switchFirmwareNumber,
        routeStationStatusId,
        status,
        errorMessage,
        createdAt,
        updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        params.excelDataId,
        params.stationName || 'Substation',
        params.voltageClass || '',
        params.vendorId,
        params.vendorWorkerId || null,
        params.workerStationAssignmentId || null,
        params.isWorkerSubmission ? 1 : 0,
        params.remarks || '',
        params.createdByUserName || 'Vendor',
        params.flagId || (params.isWorkerSubmission ? '1' : '2'),
        JSON.stringify(params.fileTypeIds),
        JSON.stringify(params.files),
        params.switchSerialNumber || '',
        params.resilientSerialNumber || '',
        params.switchFirmwareNumber || '',
        params.routeStationStatusId || 0,
        'pending',
        '',
        now,
        now,
      ],
    );

    const insertedId = result.insertId;
    console.log(`[SQLite] Queued offline submission for station ${params.stationName} (ID: ${insertedId})`);
    notifyOfflineQueueChanged(params.vendorId);
    return { success: true, id: insertedId };
  } catch (error: any) {
    console.error('[SQLite] Error queuing offline submission:', error);
    return { success: false, error: error?.message || 'Database error' };
  }
};

/**
 * Retrieve all pending or failed submissions stored in SQLite
 */
export const getOfflineSubmissions = async (
  vendorId?: number,
): Promise<OfflineSubmissionItem[]> => {
  try {
    const db = await getDatabase();
    const query = vendorId
      ? 'SELECT * FROM offline_submissions WHERE vendorId = ? ORDER BY createdAt DESC'
      : 'SELECT * FROM offline_submissions ORDER BY createdAt DESC';
    const params = vendorId ? [vendorId] : [];

    const result = await db.execute(query, params);
    const list: OfflineSubmissionItem[] = [];

    if (result && result.rows) {
      for (const row of result.rows) {
        let fileTypeIds: number[] = [];
        let files: OfflineSubmissionFile[] = [];

        try {
          if (row.fileTypeIds && typeof row.fileTypeIds === 'string') {
            fileTypeIds = JSON.parse(row.fileTypeIds);
          }
        } catch (_) {}

        try {
          if (row.filesJson && typeof row.filesJson === 'string') {
            files = JSON.parse(row.filesJson);
          }
        } catch (_) {}

        list.push({
          id: Number(row.id),
          excelDataId: Number(row.excelDataId),
          stationName: (row.stationName as string) || 'Substation',
          voltageClass: (row.voltageClass as string) || '',
          vendorId: Number(row.vendorId),
          vendorWorkerId: row.vendorWorkerId ? Number(row.vendorWorkerId) : undefined,
          workerStationAssignmentId: row.workerStationAssignmentId ? Number(row.workerStationAssignmentId) : undefined,
          isWorkerSubmission: Boolean(row.isWorkerSubmission),
          remarks: (row.remarks as string) || '',
          createdByUserName: (row.createdByUserName as string) || 'Vendor',
          flagId: (row.flagId as string) || '2',
          fileTypeIds,
          files,
          switchSerialNumber: (row.switchSerialNumber as string) || '',
          resilientSerialNumber: (row.resilientSerialNumber as string) || '',
          switchFirmwareNumber: (row.switchFirmwareNumber as string) || '',
          routeStationStatusId: Number(row.routeStationStatusId || 0),
          status: (row.status as any) || 'pending',
          errorMessage: (row.errorMessage as string) || undefined,
          createdAt: Number(row.createdAt || 0),
          updatedAt: Number(row.updatedAt || 0),
        });
      }
    }

    return list;
  } catch (error) {
    console.error('[SQLite] Error reading offline submissions:', error);
    return [];
  }
};

/**
 * Delete a submission row from SQLite upon successful API submission (Flushed!)
 */
export const deleteOfflineSubmission = async (id: number): Promise<boolean> => {
  try {
    const db = await getDatabase();
    await db.execute('DELETE FROM offline_submissions WHERE id = ?', [id]);
    console.log(`[SQLite] Flushed offline submission #${id} from database`);
    notifyOfflineQueueChanged();
    return true;
  } catch (error) {
    console.error('[SQLite] Error deleting offline submission:', error);
    return false;
  }
};

/**
 * Update the status of an offline submission
 */
export const updateOfflineSubmissionStatus = async (
  id: number,
  status: 'pending' | 'syncing' | 'failed',
  errorMessage?: string,
): Promise<boolean> => {
  try {
    const db = await getDatabase();
    await db.execute(
      'UPDATE offline_submissions SET status = ?, errorMessage = ?, updatedAt = ? WHERE id = ?',
      [status, errorMessage || '', Date.now(), id],
    );
    return true;
  } catch (error) {
    console.error('[SQLite] Error updating offline submission status:', error);
    return false;
  }
};

/**
 * Get count of pending offline submissions
 */
export const getOfflineSubmissionsCount = async (
  vendorId?: number,
): Promise<number> => {
  try {
    const db = await getDatabase();
    const query = vendorId
      ? 'SELECT COUNT(*) as count FROM offline_submissions WHERE vendorId = ?'
      : 'SELECT COUNT(*) as count FROM offline_submissions';
    const params = vendorId ? [vendorId] : [];

    const result = await db.execute(query, params);
    if (result && result.rows && result.rows.length > 0) {
      return Number(result.rows[0].count || 0);
    }
    return 0;
  } catch (error) {
    console.error('[SQLite] Error counting offline submissions:', error);
    return 0;
  }
};

// Concurrency guards to prevent duplicate parallel sync submissions
let isSyncAllInProgress = false;
const activeSyncingItemIds = new Set<number>();

/**
 * Synchronize a single queued offline submission through the API
 */
export const syncSingleOfflineSubmission = async (
  item: OfflineSubmissionItem,
): Promise<{ success: boolean; error?: string }> => {
  // Prevent duplicate concurrent sync for the same row
  if (activeSyncingItemIds.has(item.id)) {
    console.log(`[SQLite] Item #${item.id} is already actively syncing, ignoring duplicate trigger.`);
    return { success: false, error: 'Already syncing' };
  }

  activeSyncingItemIds.add(item.id);
  try {
    await updateOfflineSubmissionStatus(item.id, 'syncing');

    // Determine if this is a worker submission:
    // 1. flagId '1' is strictly for worker submissions
    // 2. flagId '2' is strictly for vendor submissions
    // 3. Otherwise fall back to isWorkerSubmission boolean flag
    const isWorkerSubmission =
      item.flagId === '1' ||
      (item.flagId !== '2' && Boolean(item.isWorkerSubmission));

    const formData = new FormData();
    if (isWorkerSubmission) {
      formData.append('flagId', '1');
      formData.append(
        'WorkerStationAssignmentId',
        String(item.workerStationAssignmentId || 0),
      );
      formData.append(
        'WorkerId',
        String(item.vendorWorkerId || item.vendorId || 0),
      );
      formData.append('ExcelDataId', String(item.excelDataId));
      formData.append(
        'Remarks',
        item.remarks.trim() || 'completed',
      );
      formData.append('SwitchFirmWareNumber', item.switchFirmwareNumber || 'N/A');
      formData.append('SwitchSerialNumber', item.switchSerialNumber || 'N/A');
      formData.append('ResilientSerialNumber', item.resilientSerialNumber || 'N/A');
      formData.append('CreatedByUserName', item.createdByUserName || 'Worker');
      formData.append('FileTypeIds', JSON.stringify(item.fileTypeIds));
      formData.append('FileTypeId', JSON.stringify(item.fileTypeIds));
    } else {
      formData.append('ExcelDataId', String(item.excelDataId));
      formData.append('VendorId', String(item.vendorId));
      if (item.vendorWorkerId) {
        formData.append('VendorWorkerId', String(item.vendorWorkerId));
      }
      formData.append(
        'Remarks',
        item.remarks.trim() || `Installation completed for ${item.stationName}`,
      );
      formData.append('CreatedByUserName', item.createdByUserName || 'Vendor');
      formData.append('flagId', item.flagId || '2');
      formData.append('FileTypeId', JSON.stringify(item.fileTypeIds));
      formData.append('FileTypeIds', JSON.stringify(item.fileTypeIds));
      formData.append('SwitchSerialNumber', item.switchSerialNumber || 'N/A');
      formData.append('ResilientSerialNumber', item.resilientSerialNumber || 'N/A');
      formData.append('SwitchFirmWareNumber', item.switchFirmwareNumber || 'N/A');
      formData.append('RouteStationStatusId', String(item.routeStationStatusId || 0));
    }

    // Append all stored files
    item.files.forEach(file => {
      if (file && file.uri) {
        const fileExtension = file.name ? file.name.split('.').pop() : 'jpg';
        const fileName = file.name || `proof_${file.fileTypeId}_${Date.now()}.${fileExtension}`;
        const fileType = file.type || 'image/jpeg';

        formData.append('files', {
          uri: Platform.OS === 'android' ? file.uri : file.uri.replace('file://', ''),
          name: fileName,
          type: fileType,
        } as any);
      }
    });

    // Call the appropriate API service
    if (isWorkerSubmission) {
      await apiService.insertWorkerStationSubmission(formData);
    } else {
      await apiService.createInstallationSubmission(formData);
    }

    // FLUSH FROM DB: Delete row only after successful submission
    await deleteOfflineSubmission(item.id);

    // Also clear any matching draft in draft table
    await clearStationProofDraft(item.excelDataId, item.vendorId);

    console.log(`[SQLite] Successfully synced and flushed submission for station ${item.stationName}`);
    return { success: true };
  } catch (error: any) {
    const errorMsg = error?.message || 'Submission failed';
    console.warn(`[SQLite] Sync failed for submission #${item.id}:`, errorMsg);
    await updateOfflineSubmissionStatus(item.id, 'failed', errorMsg);
    return { success: false, error: errorMsg };
  } finally {
    activeSyncingItemIds.delete(item.id);
  }
};

/**
 * Synchronize all queued offline submissions (triggered when back online, or every 4 hours, or manually)
 */
export const syncAllOfflineSubmissions = async (
  vendorId?: number,
): Promise<{ total: number; synced: number; failed: number }> => {
  // Global mutex: ensure only one syncAll process can run at a time
  if (isSyncAllInProgress) {
    console.log('[SQLite Sync] syncAllOfflineSubmissions is already running, skipping parallel invocation.');
    return { total: 0, synced: 0, failed: 0 };
  }

  isSyncAllInProgress = true;
  try {
    const allItems = await getOfflineSubmissions(vendorId);
    // Ignore items currently in-flight to prevent duplicate uploads
    const items = allItems.filter(
      item => !activeSyncingItemIds.has(item.id) && item.status !== 'syncing',
    );

    if (items.length === 0) {
      return { total: 0, synced: 0, failed: 0 };
    }

    console.log(`[SQLite Sync] Starting background sync for ${items.length} offline submissions...`);
    let synced = 0;
    let failed = 0;

    for (const item of items) {
      const result = await syncSingleOfflineSubmission(item);
      if (result.success) {
        synced++;
      } else {
        failed++;
      }
    }

    console.log(`[SQLite Sync] Completed sync: ${synced} synced, ${failed} failed`);
    notifyOfflineQueueChanged(vendorId);
    return { total: items.length, synced, failed };
  } finally {
    isSyncAllInProgress = false;
  }
};



