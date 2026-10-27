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

    const data = await response.json();
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



