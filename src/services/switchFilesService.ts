import { NativeModules, Platform, Alert } from 'react-native';

const { SwitchFilesModule } = NativeModules;

export interface SwitchFileInfo {
  fileName: string;
  displayName: string;
  description: string;
  badge: string;
  icon: string;
  sizeBytes?: number;
  sizeFormatted?: string;
}

export const KNOWN_SWITCH_FILES: SwitchFileInfo[] = [
  {
    fileName: 'switchfirmware.imag',
    displayName: 'Switch Firmware Image',
    description: 'System binary firmware image for network switch (.imag)',
    badge: 'Firmware .imag',
    icon: '💾',
  },
  {
    fileName: 'switchconfig.cfg',
    displayName: 'Switch Configuration File',
    description: 'Pre-configured port, VLAN & network routing configuration (.cfg)',
    badge: 'Config .cfg',
    icon: '⚙️',
  },
];

export interface SwitchFileDownloadResult {
  success: boolean;
  filePath: string;
  fileName: string;
  message?: string;
}

export interface SwitchFileBatchDownloadResult {
  success: boolean;
  filePaths: string[];
  message?: string;
}

export async function getSwitchFilesInfo(): Promise<SwitchFileInfo[]> {
  if (Platform.OS === 'android' && SwitchFilesModule?.getSwitchFilesInfo) {
    try {
      const nativeList: Array<{ fileName: string; sizeBytes: number; exists: boolean }> =
        await SwitchFilesModule.getSwitchFilesInfo();

      return KNOWN_SWITCH_FILES.map(item => {
        const found = nativeList?.find(n => n.fileName.toLowerCase() === item.fileName.toLowerCase());
        const bytes = found?.sizeBytes || 0;
        let formatted = '';
        if (bytes > 1024 * 1024) {
          formatted = `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
        } else if (bytes > 1024) {
          formatted = `${(bytes / 1024).toFixed(1)} KB`;
        } else if (bytes > 0) {
          formatted = `${bytes} B`;
        }

        return {
          ...item,
          sizeBytes: bytes,
          sizeFormatted: formatted,
        };
      });
    } catch (e) {
      console.warn('SwitchFilesModule.getSwitchFilesInfo error:', e);
    }
  }

  return KNOWN_SWITCH_FILES;
}

export async function downloadSwitchFile(fileName: string): Promise<SwitchFileDownloadResult> {
  if (Platform.OS === 'android' && SwitchFilesModule?.downloadSwitchFile) {
    return await SwitchFilesModule.downloadSwitchFile(fileName);
  }
  throw new Error('Switch file download is currently supported on Android.');
}

export async function shareSwitchFile(fileName: string): Promise<boolean> {
  if (Platform.OS === 'android' && SwitchFilesModule?.shareSwitchFile) {
    return await SwitchFilesModule.shareSwitchFile(fileName);
  }
  throw new Error('Switch file sharing is currently supported on Android.');
}

export async function downloadAllSwitchFiles(): Promise<SwitchFileBatchDownloadResult> {
  if (Platform.OS === 'android' && SwitchFilesModule?.downloadAllSwitchFiles) {
    return await SwitchFilesModule.downloadAllSwitchFiles();
  }
  throw new Error('Switch files batch download is currently supported on Android.');
}

export async function shareAllSwitchFiles(): Promise<boolean> {
  if (Platform.OS === 'android' && SwitchFilesModule?.shareAllSwitchFiles) {
    return await SwitchFilesModule.shareAllSwitchFiles();
  }
  throw new Error('Switch files sharing is currently supported on Android.');
}
