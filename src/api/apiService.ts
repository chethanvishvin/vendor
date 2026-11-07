import {
  LoginRequest,
  LoginResponse,
  FetchVendorDetailResponse,
  FetchCompletedStationsResponse,
  FetchDashboardCountResponse,
  VendorFileType,
  DEFAULT_FILE_TYPES,
  InstallationSubmissionResponse,
  CreateVendorWorkerResponse,
  ChangeVendorWorkerPasswordRequest,
  ChangeVendorWorkerPasswordResponse,
  FetchVendorWorkersResponse,
  EditVendorWorkerRequest,
  EditVendorWorkerResponse,
  WorkerDropdownItem,
  SubstationDropdownItem,
  FetchAssignWorkerDpdwnResponse,
  InsertWorkerAssignmentRequest,
  InsertWorkerAssignmentResponse,
  VendorWorkerStationAssignmentItem,
  WorkerPendingStationItem,
  WorkerCompletedStationItem,
  FetchPendingWorkerListResponse,
  InsertWorkerStationSubmissionResponse,
  FetchWorkerInsertDropdownResponse,
  SingleStationWorkerDropdownItem,
  FetchSingleStationWorkerDropdownResponse,
  InsertAssignToWorkerRequest,
  InsertAssignToWorkerResponse,
  ApkFetchCompletedStationResponse,
  CompletedStationItem,
} from '../types';

const ENDPOINTS = [
  'http://192.168.23.91:5080/rna-service',
];

let activeEndpointIndex = 0;

export const getActiveBaseUrl = () => ENDPOINTS[activeEndpointIndex];
// In-memory cache for base64 installation photos
const imageBase64Cache = new Map<number | string, string>();

export const clearInstallationImageCache = (fileId?: number) => {
  if (fileId !== undefined) {
    imageBase64Cache.delete(`view_file_${fileId}`);
    imageBase64Cache.delete(fileId);
  } else {
    imageBase64Cache.clear();
  }
};

async function fetchWithFallback(
  path: string,
  options?: RequestInit,
): Promise<Response> {
  const primaryUrl = ENDPOINTS[activeEndpointIndex] || ENDPOINTS[0];
  try {
    return await fetch(`${primaryUrl}${path}`, options);
  } catch (err: any) {
    if (ENDPOINTS.length > 1) {
      const altIndex = (activeEndpointIndex + 1) % ENDPOINTS.length;
      const fallbackUrl = ENDPOINTS[altIndex];
      if (fallbackUrl && fallbackUrl !== primaryUrl) {
        try {
          const response = await fetch(`${fallbackUrl}${path}`, options);
          activeEndpointIndex = altIndex;
          return response;
        } catch (fallbackErr: any) {
          // Fallback also failed
        }
      }
    }
    throw new Error(
      `Network request failed. Unable to connect to backend via ${primaryUrl}. Ensure device is connected to LAN.`,
    );
  }
}

async function parseResponseJsonSafe(
  response: Response,
  defaultErrorMsg: string,
): Promise<any> {
  let text = '';
  if (typeof response.text === 'function') {
    text = await response.text();
  } else if (typeof response.json === 'function') {
    return await response.json();
  }
  try {
    return JSON.parse(text);
  } catch {
    const preMatch = text.match(/<pre>([\s\S]*?)<\/pre>/i);
    if (preMatch && preMatch[1]) {
      const cleanPre = preMatch[1]
        .replace(/<br\s*[\/]?>/gi, '\n')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .trim();
      const firstLine = cleanPre.split('\n')[0].trim();
      if (firstLine.includes('MulterError: Unexpected field')) {
        throw new Error(
          'Backend file limit exceeded: The backend currently only accepts a maximum of 10 files. Please update backend InstallationUpload.js (upload.array limit) to 50 files.',
        );
      }
      throw new Error(firstLine || cleanPre);
    }
    if (!response.ok) {
      throw new Error(`Server error (${response.status}): ${defaultErrorMsg}`);
    }
    throw new Error(defaultErrorMsg);
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
      const msg = (data?.message || '').toLowerCase();
      if (
        msg.includes('no data') ||
        msg.includes('not found') ||
        msg.includes('no assignment') ||
        msg.includes('not assigned') ||
        msg.includes('no record') ||
        msg.includes('empty')
      ) {
        return {
          status: true,
          message: data?.message || 'No assignments found',
          result: {
            vendor: data?.result?.vendor || ({} as any),
            assignments: [],
          },
        };
      }
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
      const msg = (data?.message || '').toLowerCase();
      if (
        msg.includes('no data') ||
        msg.includes('not found') ||
        msg.includes('no completed') ||
        msg.includes('not assigned') ||
        msg.includes('no record') ||
        msg.includes('empty')
      ) {
        return {
          status: true,
          message: data?.message || 'No completed stations',
          data: [],
        };
      }
      throw new Error(
        data.message || 'Failed to fetch completed stations from server.',
      );
    }
    return data;
  },

  async fetchInstallationImageBase64(
    fileId: number,
    flagId?: number,
    isWorker: boolean = false,
  ): Promise<string> {
    const cached = imageBase64Cache.get(fileId);
    if (cached) return cached;

    // Endpoints configuration:
    // Worker view photo API: POST /vendorWorkerAssign/workerInstallationView with { flagId: 1, InstallationSubmissionFileId: fileId }
    // Vendor view photo API: POST /apkassignVendor/fetchInstallationSubmissionFile with { flagId: 2, InstallationSubmissionFileId: fileId }
    const primaryEndpoint = isWorker
      ? '/vendorWorkerAssign/workerInstallationView'
      : '/apkassignVendor/fetchInstallationSubmissionFile';
    const primaryFlag = flagId !== undefined ? flagId : (isWorker ? 1 : 2);

    const fallbackEndpoint = isWorker
      ? '/apkassignVendor/fetchInstallationSubmissionFile'
      : '/vendorWorkerAssign/workerInstallationView';
    const fallbackFlag = isWorker ? 2 : 1;

    let response: Response | null = null;
    let lastError: Error | null = null;

    try {
      response = await fetchWithFallback(primaryEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          flagId: primaryFlag,
          InstallationSubmissionFileId: fileId,
        }),
      });

      if (!response.ok) {
        throw new Error(`Endpoint ${primaryEndpoint} returned status ${response.status}`);
      }
    } catch (err: any) {
      lastError = err;
      try {
        response = await fetchWithFallback(fallbackEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            flagId: fallbackFlag,
            InstallationSubmissionFileId: fileId,
          }),
        });

        if (!response.ok) {
          throw new Error(`Endpoint ${fallbackEndpoint} returned status ${response.status}`);
        }
      } catch (fallbackErr: any) {
        throw new Error(
          `Failed to load installation photo #${fileId} (Primary: ${lastError?.message}, Fallback: ${fallbackErr.message})`,
        );
      }
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

  async fetchWorkerInstallationImageBase64(
    fileId: number,
    flagId: number = 1,
  ): Promise<string> {
    return this.fetchInstallationImageBase64(fileId, flagId, true);
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
        if (data && (data.status || data.success) && Array.isArray(data.result) && data.result.length > 0) {
          return data.result;
        }
      }
    } catch (err) {
      console.warn('fetchAssignStationDetailDropdown API call failed:', err);
    }

    return DEFAULT_FILE_TYPES;
  },

  async fetchWorkerInsertDropdown(
    flagId: number = 1,
  ): Promise<VendorFileType[]> {
    try {
      const response = await fetchWithFallback(
        '/vendorWorkerAssign/fetchInsertDpdwn',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({ flagId }),
        },
      );

      const data = await response.json();
      if (data && data.status && Array.isArray(data.result) && data.result.length > 0) {
        return data.result;
      }
      if (Array.isArray(data.result) && data.result.length > 0) {
        return data.result;
      }
    } catch (err) {
      console.warn('fetchWorkerInsertDropdown API call failed:', err);
    }

    return DEFAULT_FILE_TYPES;
  },

  async insertWorkerStationSubmission(
    formData: FormData,
  ): Promise<InsertWorkerStationSubmissionResponse> {
    const response = await fetchWithFallback(
      '/vendorWorkerAssign/insertingWorkerStationSubmission',
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
        },
        body: formData,
      },
    );

    const data = await parseResponseJsonSafe(
      response,
      'Failed to submit worker station installation.',
    );
    if (!response.ok || data.status === false) {
      throw new Error(
        data.message || 'Failed to submit worker station installation.',
      );
    }
    return data;
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
      } catch (_) { }
    }

    const data = await parseResponseJsonSafe(
      response,
      'Failed to submit installation proof.',
    );
    if (!response.ok || (data.status === false || data.success === false)) {
      throw new Error(
        data.message || 'Failed to submit installation proof.',
      );
    }
    return data;
  },

  async createReUploadInstallationSubmission(
    formData: FormData,
  ): Promise<InstallationSubmissionResponse> {
    let response: Response | null = null;
    let lastError: any = null;

    // Try primary URL, then explicit 192.168.23.82 as instructed, then fallback
    const targetUrls = [
      `${getActiveBaseUrl()}/assignVendor/createReUploadInstallationSubmission`,
      'http://192.168.23.82:5080/rna-service/assignVendor/createReUploadInstallationSubmission',
      'http://192.168.23.91:5080/rna-service/assignVendor/createReUploadInstallationSubmission',
    ];

    for (const url of targetUrls) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
          },
          body: formData,
        });
        if (res.ok || res.status < 500) {
          response = res;
          break;
        }
      } catch (err) {
        lastError = err;
      }
    }

    if (!response) {
      if (lastError) throw lastError;
      throw new Error('Unable to connect to re-upload submission endpoint.');
    }

    const data = await parseResponseJsonSafe(
      response,
      'Failed to re-upload installation proof.',
    );
    if (!response.ok || (data.status === false || data.success === false)) {
      throw new Error(
        data.message || 'Failed to re-upload installation proof.',
      );
    }
    return data;
  },

  async apkfetchCompletedStation(
    vendorId: number,
    flagId: number = 1,
    workerId?: number | null,
  ): Promise<CompletedStationItem[]> {
    const payload: any = {
      flagId,
      vendorId,
    };
    if (workerId) {
      payload.WorkerId = workerId;
    }

    const response = await fetchWithFallback(
      '/apkassignVendor/apkfetchCompletedStation',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
      },
    );

    const data: ApkFetchCompletedStationResponse = await response.json();
    if (!response.ok || !data.status) {
      throw new Error(data.message || 'Failed to fetch completed stations.');
    }
    return data.result || [];
  },

  async viewInstallationSubmissionFile(
    fileId: number,
    fileName?: string,
  ): Promise<string> {
    const cacheKey = `view_file_${fileId}`;
    const cached = imageBase64Cache.get(cacheKey);
    if (cached) return cached;

    const primaryEndpoint = '/assignVendor/ViewInstallationSubmissionFile';
    const fallbackEndpoint = '/apkassignVendor/fetchInstallationSubmissionFile';

    let response: Response | null = null;
    let lastError: any = null;

    try {
      response = await fetchWithFallback(primaryEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: '*/*',
        },
        body: JSON.stringify({
          InstallationSubmissionFileId: fileId,
          installationSubmissionFileId: fileId,
          flagId: 2,
          fileName: fileName || '',
        }),
      });

      if (!response.ok) {
        throw new Error(`Endpoint ${primaryEndpoint} returned status ${response.status}`);
      }
    } catch (err: any) {
      lastError = err;
      try {
        response = await fetchWithFallback(fallbackEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: '*/*',
          },
          body: JSON.stringify({
            InstallationSubmissionFileId: fileId,
            flagId: 2,
          }),
        });
        if (!response.ok) {
          throw new Error(`Fallback returned status ${response.status}`);
        }
      } catch (fallbackErr: any) {
        throw new Error(
          `Failed to load photo #${fileId}: ${lastError?.message || fallbackErr?.message}`,
        );
      }
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const json = await response.json();
      if (json.base64) {
        const uri = json.base64.startsWith('data:')
          ? json.base64
          : `data:image/jpeg;base64,${json.base64}`;
        imageBase64Cache.set(cacheKey, uri);
        return uri;
      }
      if (json.url || json.fileUrl) {
        const u = json.url || json.fileUrl;
        imageBase64Cache.set(cacheKey, u);
        return u;
      }
    }

    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64data = reader.result as string;
        imageBase64Cache.set(cacheKey, base64data);
        resolve(base64data);
      };
      reader.onerror = () => reject(new Error('Failed to convert blob to base64'));
      reader.readAsDataURL(blob);
    });
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

  async createVendorWorker(formData: FormData): Promise<CreateVendorWorkerResponse> {
    const response = await fetchWithFallback(
      '/apkassignVendor/apkcreateVendorWorkerUser',
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
        },
        body: formData,
      },
    );

    const data = await response.json();
    if (!response.ok || !data.status) {
      throw new Error(data.message || 'Failed to create vendor worker.');
    }
    return data;
  },

  async changeVendorWorkerPassword(
    params: ChangeVendorWorkerPasswordRequest,
  ): Promise<ChangeVendorWorkerPasswordResponse> {
    const response = await fetchWithFallback(
      '/apkassignVendor/apkchangeVendorWorkerUserPassword',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(params),
      },
    );

    const data = await response.json();
    if (!response.ok || !data.status) {
      throw new Error(data.message || 'Failed to change worker password.');
    }
    return data;
  },

  async fetchVendorWorkers(
    vendorId: number,
    flagId: number = 2,
  ): Promise<FetchVendorWorkersResponse> {
    const response = await fetchWithFallback(
      '/apkassignVendor/apkfetchVendorWorkerUser',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ flagId, VendorId: vendorId }),
      },
    );

    const data = await response.json();
    if (!response.ok || !data.status) {
      throw new Error(data.message || 'Failed to fetch vendor workers.');
    }
    return data;
  },

  async editVendorWorker(
    params: EditVendorWorkerRequest,
  ): Promise<EditVendorWorkerResponse> {
    const response = await fetchWithFallback(
      '/apkassignVendor/apkEditVendorWorker',
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(params),
      },
    );

    const data = await response.json();
    if (!response.ok || !data.status) {
      throw new Error(data.message || 'Failed to update vendor worker details.');
    }
    return data;
  },

  async fetchWorkerDropdown(vendorId: number): Promise<WorkerDropdownItem[]> {
    const response = await fetchWithFallback(
      '/vendorWorkerAssign/fetchAssignWorkerDpdwn',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ flagId: 2, VendorId: vendorId }),
      },
    );

    const data = await response.json();
    if (!response.ok || !data.status) {
      throw new Error(data.message || 'Failed to fetch workers dropdown.');
    }
    return data.result || [];
  },

  async fetchSubstationDropdown(vendorId: number): Promise<SubstationDropdownItem[]> {
    const response = await fetchWithFallback(
      '/vendorWorkerAssign/fetchAssignWorkerDpdwn',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ flagId: 1, VendorId: vendorId }),
      },
    );

    const data = await response.json();
    if (!response.ok || !data.status) {
      throw new Error(data.message || 'Failed to fetch substations dropdown.');
    }
    return data.result || [];
  },

  async insertWorkerAssignment(
    params: InsertWorkerAssignmentRequest,
  ): Promise<InsertWorkerAssignmentResponse> {
    const response = await fetchWithFallback(
      '/vendorWorkerAssign/insertWorkerAssignment',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(params),
      },
    );

    const data = await response.json();
    if (!response.ok || !data.status) {
      throw new Error(data.message || 'Failed to assign substations to worker.');
    }
    return data;
  },

  async fetchVendorAssignWorkerDetails(
    vendorId: number,
    flagId: number = 1,
  ): Promise<VendorWorkerStationAssignmentItem[]> {
    const response = await fetchWithFallback(
      '/vendorWorkerAssign/fetchVendorAssignWorkerDetails',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ flagId, VendorId: vendorId }),
      },
    );

    const data = await response.json();
    // Safely parse array result even if backend sets status: false
    if (Array.isArray(data.result)) {
      return data.result;
    }
    if (data && data.status) {
      return data.result || [];
    }
    if (!response.ok) {
      throw new Error(data.message || 'Failed to fetch vendor-worker assignments.');
    }
    return data.result || [];
  },

  async fetchPendingWorkerList(
    workerId: number,
    flagId: number = 1,
  ): Promise<WorkerPendingStationItem[]> {
    const response = await fetchWithFallback(
      '/vendorWorkerAssign/fetchPenidngWorkerList',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ flagId, WorkerId: workerId }),
      },
    );

    const data = await response.json();
    if (Array.isArray(data.result)) {
      return data.result;
    }
    if (data && data.status && Array.isArray(data.result)) {
      return data.result;
    }
    const msg = (data?.message || '').toLowerCase();
    if (
      msg.includes('no data') ||
      msg.includes('not found') ||
      msg.includes('no pending') ||
      msg.includes('not assigned') ||
      msg.includes('no record') ||
      msg.includes('empty')
    ) {
      return [];
    }
    if (!response.ok) {
      throw new Error(data.message || 'Failed to fetch pending stations for worker.');
    }
    return data.result || [];
  },

  async fetchCompletedWorkerList(
    workerId: number,
    flagId: number = 2,
  ): Promise<WorkerCompletedStationItem[]> {
    return this.fetchPendingWorkerList(workerId, flagId);
  },

  async fetchSingleStationWorkers(
    vendorId: number,
    flagId: number = 2,
  ): Promise<SingleStationWorkerDropdownItem[]> {
    const response = await fetchWithFallback(
      '/vendorAssignDetail/AssigntoWorkerDrpdwnbsedonVendor',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ flagId, VendorId: vendorId }),
      },
    );

    const data: FetchSingleStationWorkerDropdownResponse = await response.json();
    if (!response.ok || !data.status) {
      throw new Error(data.message || 'Failed to fetch workers list.');
    }
    return data.data || [];
  },

  async insertSingleStationAssignToWorker(
    params: InsertAssignToWorkerRequest,
  ): Promise<InsertAssignToWorkerResponse> {
    const response = await fetchWithFallback(
      '/vendorAssignDetail/InsertAssigntoWorker',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(params),
      },
    );

    const data: InsertAssignToWorkerResponse = await response.json();
    if (!response.ok || !data.status) {
      throw new Error(data.message || 'Failed to assign station to worker.');
    }
    return data;
  },
};



