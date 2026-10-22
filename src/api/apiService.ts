import {
  LoginRequest,
  LoginResponse,
  FetchVendorDetailResponse,
  FetchCompletedStationsResponse,
  FetchDashboardCountResponse,
  VendorFileType,
  InstallationSubmissionResponse,
} from '../types';

const ENDPOINTS = [
  'https://rna.vishvin.com/api/rna-service',
];

let activeEndpointIndex = 0;

export const getActiveBaseUrl = () => ENDPOINTS[activeEndpointIndex];

// In-memory cache for base64 installation photos
const imageBase64Cache = new Map<number, string>();

async function fetchWithFallback(
  path: string,
  options?: RequestInit,
): Promise<Response> {
  const tryFetch = async (baseUrl: string) => {
    return await fetch(`${baseUrl}${path}`, options);
  };

  const primaryUrl = ENDPOINTS[activeEndpointIndex];
  try {
    return await tryFetch(primaryUrl);
  } catch (err: any) {
    const altIndex = 1 - activeEndpointIndex;
    const fallbackUrl = ENDPOINTS[altIndex];
    try {
      const response = await tryFetch(fallbackUrl);
      activeEndpointIndex = altIndex;
      return response;
    } catch (fallbackErr: any) {
      throw new Error(
        `Network request failed. Unable to connect to backend via ${primaryUrl} or ${fallbackUrl}. Ensure ADB reverse is active or device is connected to LAN.`,
      );
    }
  }
}

export const apiService = {
  async login(credentials: LoginRequest): Promise<LoginResponse> {
    const response = await fetchWithFallback('/Vendor/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(credentials),
    });

    const data = await response.json();
    if (!response.ok || !data.status) {
      throw new Error(data.message || 'Vendor login failed. Please check credentials.');
    }
    return data;
  },

  async fetchVendorWiseDetail(
    vendorId: number,
    flagId: number = 2,
  ): Promise<FetchVendorDetailResponse> {
    const response = await fetchWithFallback(
      '/apkassignVendor/fetchVendorWiseDetail',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ flagId, vendorId }),
      },
    );

    const data = await response.json();
    if (!response.ok || !data.status) {
      throw new Error(
        data.message || 'Failed to fetch vendor assignments details from server.',
      );
    }
    return data;
  },

  async fetchCompletedStations(
    vendorId: number,
    flagId: number = 2,
  ): Promise<FetchCompletedStationsResponse> {
    const response = await fetchWithFallback(
      '/apkassignVendor/fetchCompletedStationVendorWise',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ flagId, vendorId }),
      },
    );

    const data = await response.json();
    if (!response.ok || !data.status) {
      throw new Error(
        data.message || 'Failed to fetch completed stations from server.',
      );
    }
    return data;
  },

  async fetchInstallationImageBase64(
    fileId: number,
    flagId: number = 2,
  ): Promise<string> {
    const cached = imageBase64Cache.get(fileId);
    if (cached) return cached;

    const response = await fetchWithFallback(
      '/apkassignVendor/fetchInstallationSubmissionFile',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          flagId,
          InstallationSubmissionFileId: fileId,
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Failed to load installation photo (Status ${response.status})`);
    }

    const blob = await response.blob();
    const base64Data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result);
        } else {
          reject(new Error('Failed to convert image to base64'));
        }
      };
      reader.onerror = () => reject(new Error('FileReader error'));
      reader.readAsDataURL(blob);
    });

    imageBase64Cache.set(fileId, base64Data);
    return base64Data;
  },

  async fetchAssignStationDetailDropdown(
    flagId: number = 2,
  ): Promise<VendorFileType[]> {
    try {
      let response = await fetchWithFallback(
        '/assignVendor/fetchAssignStationDetailDpdwn',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({ flagId }),
        },
      );

      if (!response.ok) {
        response = await fetchWithFallback(
          '/assignVendor/fetchAssignStationDetailDpdown',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify({ flagId }),
          },
        );
      }

      if (response.ok) {
        const data = await response.json();
        if (data && (data.status || data.success) && Array.isArray(data.result)) {
          return data.result;
        }
      }
    } catch (err) {
      console.warn('fetchAssignStationDetailDropdown API call failed:', err);
    }

    return [
      { VendorFileTypeId: 4, VendorFileTypeName: 'RackFile' },
      { VendorFileTypeId: 5, VendorFileTypeName: 'PointFile' },
      { VendorFileTypeId: 6, VendorFileTypeName: 'RTU/SASFile' },
      { VendorFileTypeId: 7, VendorFileTypeName: 'AnnextureFile' },
      { VendorFileTypeId: 8, VendorFileTypeName: 'LIU OFC Splicing File' },
    ];
  },

  async createInstallationSubmission(
    formData: FormData,
  ): Promise<InstallationSubmissionResponse> {
    let response: Response;
    try {
      response = await fetchWithFallback(
        '/assignVendor/createInstallationSubmission',
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
          },
          body: formData,
        },
      );
    } catch (err: any) {
      throw err;
    }

    // Fallback if rna-service path returns 404 and ma-service is used
    if (response.status === 404) {
      try {
        const altBase = ENDPOINTS[activeEndpointIndex].replace(
          '/rna-service',
          '/ma-service',
        );
        const altResponse = await fetch(
          `${altBase}/assignVendor/createInstallationSubmission`,
          {
            method: 'POST',
            headers: {
              Accept: 'application/json',
            },
            body: formData,
          },
        );
        if (altResponse.ok) {
          response = altResponse;
        }
      } catch (_) {}
    }

    const data = await response.json();
    if (!response.ok || (data.status === false || data.success === false)) {
      throw new Error(
        data.message || 'Failed to submit installation proof.',
      );
    }
    return data;
  },

  async fetchDashboardCount(
    vendorId: number,
    flagId: number = 2,
  ): Promise<FetchDashboardCountResponse> {
    const response = await fetchWithFallback(
      '/apkassignVendor/apkfetchDashboardCount',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ flagId, vendorId }),
      },
    );

    const data = await response.json();
    if (!response.ok || !data.status) {
      throw new Error(
        data.message || 'Failed to fetch dashboard count from server.',
      );
    }
    return data;
  },
};



