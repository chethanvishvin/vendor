import { NativeModules, Platform, Share, Alert } from 'react-native';

const { AnnexurePdfModule } = NativeModules;

export const DEFAULT_DWA_NO = '0228 | B31/SEE(IT)/EE(IT-4)/AEE3/76452/1/2026-2027';
export const DEFAULT_DWA_DATE = '02 JUL 2026';

export interface StationAnnexureItem {
  substationName: string;
  officeDescription?: string;
  address?: string;
  voltageClass?: string;
}

export interface AnnexureOptions {
  substationName?: string;
  officeDescription?: string;
  stations?: StationAnnexureItem[];
  dwaNo?: string;
  date?: string;
  engineerName?: string;
  division?: string;
  circle?: string;
}

export interface AnnexureGenerateResult {
  success: boolean;
  filePath: string;
  fileName: string;
  contentUri?: string;
  fileSize?: number;
  pageCount?: number;
}

export interface AnnexureDownloadResult {
  success: boolean;
  filePath: string;
  fileName: string;
  message: string;
  pageCount?: number;
}

/**
 * Returns formatted today's date in DD/MM/YYYY
 */
export function getFormattedToday(): string {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = now.getFullYear();
  return `${day}/${month}/${year}`;
}

/**
 * Formats station name for bracket display: e.g. "Chandra Layout" -> "Chandra Layout Sub-Station"
 */
export function formatStationBracketName(stationName?: string): string {
  if (!stationName) return 'Sub-Station';
  const clean = stationName.trim().replace(/\s+(sub[- ]?station)$/i, '').trim();
  return `${clean} Sub-Station`;
}

/**
 * Formats office description combining address and station name in brackets:
 * e.g. "Office of the Assistant Engineer... Bengaluru-560040 (Chandra Layout Sub-Station)"
 */
export function formatOfficeDescription(address?: string, stationName?: string): string {
  const cleanAddress = (address || '').trim();
  const cleanStation = (stationName || '').trim();
  const bracketPart = formatStationBracketName(cleanStation);

  if (cleanAddress && cleanStation) {
    if (cleanAddress.includes(`(${bracketPart})`)) {
      return cleanAddress;
    }
    return `${cleanAddress} (${bracketPart})`;
  } else if (cleanAddress) {
    return cleanAddress;
  } else if (cleanStation) {
    return `${cleanStation} (${bracketPart})`;
  }
  return '.....................................';
}

function buildPayload(options: AnnexureOptions) {
  const stationsPayload =
    options.stations && options.stations.length > 0
      ? options.stations.map(s => ({
          substationName: s.substationName || 'Substation',
          officeDescription:
            s.officeDescription || formatOfficeDescription(s.address, s.substationName),
        }))
      : undefined;

  return {
    substationName:
      options.substationName || stationsPayload?.[0]?.substationName || 'Substation',
    officeDescription: options.officeDescription || '',
    stations: stationsPayload,
    dwaNo: options.dwaNo || DEFAULT_DWA_NO,
    date: options.date || DEFAULT_DWA_DATE,
    engineerName: options.engineerName || '',
    division: options.division || '',
    circle: options.circle || '',
  };
}

/**
 * Generates official Annexure-11 PDF
 */
export async function generateAnnexurePdf(options: AnnexureOptions): Promise<AnnexureGenerateResult> {
  const payload = buildPayload(options);

  if (Platform.OS === 'android' && AnnexurePdfModule?.generateAnnexurePdf) {
    return await AnnexurePdfModule.generateAnnexurePdf(payload);
  }

  throw new Error('Annexure PDF generation is currently supported on Android.');
}

/**
 * Saves Annexure-11 PDF directly into the device's public Downloads directory
 */
export async function downloadAnnexurePdf(options: AnnexureOptions): Promise<AnnexureDownloadResult> {
  const payload = buildPayload(options);

  if (Platform.OS === 'android' && AnnexurePdfModule?.downloadAnnexurePdf) {
    return await AnnexurePdfModule.downloadAnnexurePdf(payload);
  }

  throw new Error('Annexure PDF download is currently supported on Android.');
}

/**
 * Shares Annexure-11 PDF via native system share sheet (WhatsApp, Email, etc.)
 */
export async function shareAnnexurePdf(options: AnnexureOptions): Promise<boolean> {
  const payload = buildPayload(options);

  if (Platform.OS === 'android' && AnnexurePdfModule?.shareAnnexurePdf) {
    return await AnnexurePdfModule.shareAnnexurePdf(payload);
  }

  // Fallback for non-Android / environments without native module
  const officeDesc = payload.officeDescription || payload.substationName;
  const message = [
    'Annexure - 11',
    'Work Completion Certificate for Part-1 Portion',
    'Part-1: Implementation of Resilient Network Architecture across KPTCL Substations and the establishment of a Central Command Control Center at corporate office.',
    '',
    'To',
    'The Superintending Engineer (IT),',
    'Corporate Office, KPTCL,',
    'Indhana Bhavan, Racecourse Road, Bengaluru-09.',
    '',
    `Sub: Work Completion Certificate for the office of ${officeDesc}`,
    `Ref:DWA No: ${payload.dwaNo}`,
    `Dated: ${payload.date}`,
    '',
    'The firm have supplied the Bill of materials as required for Implementation of Resilient Network Architecture for KPTCL Substations',
    '',
    'a. The firm have successfully Implemented Resilient Network Architecture with Secured Structured Cabling and LAN Networking along with necessary cables & other consumables as per Part -1 portion of Sub Total - C of Price Schedule clause 4',
    'b. The firm have successfully installed, Tested and commissioned as per Part-1 portion of Sub Total - D of Price schedule clause 4',
    '',
    'Signature',
    'Substation In charge / JE / AE',
  ].join('\n');

  await Share.share({
    title: `Annexure-11 Work Completion Certificate - ${payload.substationName}`,
    message,
  });
  return true;
}

/**
 * Opens Annexure-11 PDF in the device's default PDF viewer
 */
export async function viewAnnexurePdf(options: AnnexureOptions): Promise<boolean> {
  const payload = buildPayload(options);

  if (Platform.OS === 'android' && AnnexurePdfModule?.viewAnnexurePdf) {
    return await AnnexurePdfModule.viewAnnexurePdf(payload);
  }

  throw new Error('Annexure PDF viewing is currently supported on Android.');
}

/**
 * Triggers native system PrintManager dialog for printing or saving to PDF
 */
export async function printAnnexure(options: AnnexureOptions): Promise<boolean> {
  const payload = buildPayload(options);

  if (Platform.OS === 'android' && AnnexurePdfModule?.printAnnexure) {
    return await AnnexurePdfModule.printAnnexure(payload);
  }

  throw new Error('Annexure Print is currently supported on Android.');
}
