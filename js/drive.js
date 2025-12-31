export const DriveService = {
    tokenClient: null,
    accessToken: null,
    tokenExpiry: 0,
    fileId: null,
    isConnected: false,
    lastSyncTime: null,  // Track last successful sync time

    getCredentials() {
        return {
            clientId: localStorage.getItem('g_client_id'),
            apiKey: localStorage.getItem('g_api_key')
        };
    },

    // Get last sync time for display
    getLastSyncTime() {
        return this.lastSyncTime;
    },

    // Format sync time for display
    getFormattedSyncTime() {
        if (!this.lastSyncTime) return null;
        const date = new Date(this.lastSyncTime);
        return date.toLocaleString();
    },

    async init() {
        const { clientId, apiKey } = this.getCredentials();
        if (!clientId || !apiKey) return false;

        return new Promise((resolve) => {
            if (window.gapi && window.google) {
                this._initGapi(apiKey, clientId, resolve);
            } else {
                const check = setInterval(() => {
                    if (window.gapi && window.google) {
                        clearInterval(check);
                        this._initGapi(apiKey, clientId, resolve);
                    }
                }, 100);
            }
        });
    },

    _initGapi(apiKey, clientId, resolve) {
        gapi.load('client', async () => {
            try {
                await gapi.client.init({
                    apiKey: apiKey,
                    discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'],
                });

                // Restore Token Logic
                const storedToken = localStorage.getItem('g_access_token');

                if (storedToken) {
                    gapi.client.setToken({ access_token: storedToken });
                    this.accessToken = storedToken;
                    this.isConnected = true;
                    window.dispatchEvent(new CustomEvent('drive-connected'));
                }

                // GIS Init
                this.tokenClient = google.accounts.oauth2.initTokenClient({
                    client_id: clientId,
                    scope: 'https://www.googleapis.com/auth/drive.file',
                    callback: (tokenResponse) => {
                        if (tokenResponse && tokenResponse.access_token) {
                            this.accessToken = tokenResponse.access_token;
                            this.isConnected = true;
                            localStorage.setItem('g_access_token', this.accessToken);
                            window.dispatchEvent(new CustomEvent('drive-connected'));
                        }
                    },
                });

                resolve(true);
            } catch (err) {
                console.error("GAPI Init Error", err);
                resolve(false);
            }
        });
    },

    async signIn() {
        if (!this.tokenClient) {
            const success = await this.init();
            if (!success) {
                window.dispatchEvent(new CustomEvent('toast', { detail: { message: "GAPI Missing", type: "error" } }));
                return;
            }
        }

        if (this.isConnected) {
            // Silent refresh attempt
            this.tokenClient.requestAccessToken({ prompt: '' });
        } else {
            this.tokenClient.requestAccessToken({ prompt: 'consent' });
        }
    },

    async findFile() {
        try {
            const response = await gapi.client.drive.files.list({
                'pageSize': 1,
                'fields': "files(id, name)",
                'q': "name = 'myFodmap.json' and trashed = false"
            });
            const files = response.result.files;
            if (files && files.length > 0) {
                this.fileId = files[0].id;
                return this.fileId;
            }
        } catch (err) {
            console.error("Find File Error", err);
            // If auth error, mark as disconnected and throw for re-login
            if (err.status === 401 || err.status === 403) {
                this.isConnected = false;
                localStorage.removeItem('g_access_token');
                throw new Error('AUTH_EXPIRED');
            }
        }
        return null;
    },

    async downloadFile() {
        if (!this.fileId) await this.findFile();
        if (!this.fileId) return null; // No file exists yet, not an error

        try {
            const response = await gapi.client.drive.files.get({
                fileId: this.fileId,
                alt: 'media'
            });
            return response.body || response.result;
        } catch (err) {
            console.error("Download Error", err);
            // Check if it's an auth error - throw for re-login
            if (err.status === 401 || err.status === 403) {
                this.isConnected = false;
                localStorage.removeItem('g_access_token');
                throw new Error('AUTH_EXPIRED');
            }
            return null;
        }
    },

    // Get cloud data with timestamp for comparison
    async getCloudDataWithTimestamp() {
        const cloudData = await this.downloadFile();
        if (!cloudData) return null;

        try {
            let parsed;
            if (typeof cloudData === 'string') {
                parsed = JSON.parse(cloudData);
            } else {
                parsed = cloudData;
            }
            return {
                data: parsed,
                timestamp: parsed.lastModified || null
            };
        } catch (e) {
            console.error("Failed to parse cloud data", e);
            return null;
        }
    },

    async saveFile(contentString) {
        if (!this.isConnected) {
            console.log("Not connected to Drive, skipping cloud save");
            return false;
        }

        // Check if online
        if (!navigator.onLine) {
            console.log("Offline, skipping cloud save");
            return false;
        }

        if (!this.fileId) {
            await this.findFile();
        }

        const metadata = {
            name: 'myFodmap.json',
            mimeType: 'application/json'
        };

        // Create Multipart Body
        const boundary = '-------314159265358979323846';
        const delimiter = "\r\n--" + boundary + "\r\n";
        const close_delim = "\r\n--" + boundary + "--";

        const multipartRequestBody =
            delimiter +
            'Content-Type: application/json\r\n\r\n' +
            JSON.stringify(metadata) +
            delimiter +
            'Content-Type: application/json\r\n\r\n' +
            contentString +
            close_delim;

        try {
            if (this.fileId) {
                // Update (PATCH)
                await gapi.client.request({
                    path: '/upload/drive/v3/files/' + this.fileId,
                    method: 'PATCH',
                    params: { uploadType: 'multipart' },
                    headers: {
                        'Content-Type': 'multipart/related; boundary="' + boundary + '"'
                    },
                    body: multipartRequestBody
                });
            } else {
                // Create (POST)
                const response = await gapi.client.request({
                    path: '/upload/drive/v3/files',
                    method: 'POST',
                    params: { uploadType: 'multipart' },
                    headers: {
                        'Content-Type': 'multipart/related; boundary="' + boundary + '"'
                    },
                    body: multipartRequestBody
                });

                if (response.result && response.result.id) {
                    this.fileId = response.result.id;
                }
            }

            // Update last sync time
            this.lastSyncTime = new Date().toISOString();
            window.dispatchEvent(new CustomEvent('sync-completed', { detail: { time: this.lastSyncTime } }));
            console.log("Saved to Drive at:", this.lastSyncTime);
            return true;
        } catch (err) {
            console.error("Save Error", err);
            // Handle auth expiry - throw for re-login
            if (err.status === 401 || err.status === 403) {
                this.isConnected = false;
                localStorage.removeItem('g_access_token');
                throw new Error('AUTH_EXPIRED');
            }
            return false;
        }
    }
};
