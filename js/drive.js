export const DriveService = {
    tokenClient: null,
    accessToken: null,
    tokenExpiry: 0,
    fileId: null,
    isConnected: false,

    getCredentials() {
        return {
            clientId: localStorage.getItem('g_client_id'),
            apiKey: localStorage.getItem('g_api_key')
        };
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
                    // Typically 'drive' not 'drive.file' for discovery, scopes handle access
                    discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'],
                });

                // --- 1. Restore Token Logic ---
                // Try to load token from localStorage
                const storedToken = localStorage.getItem('g_access_token');
                // Basic expiration check (if we stored timestamp). 
                // Since we didn't store expiry before, we might just try to use it.
                // If it fails, we handle error or let user sign in.

                if (storedToken) {
                    gapi.client.setToken({ access_token: storedToken });
                    this.accessToken = storedToken;
                    this.isConnected = true;
                    // Dispatch immediately if we think we are connected
                    // But verify a call first? Or just assume and let sync fail if invalid?
                    // Let's assume valid to make UI instant.
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
                            // Store in LocalStorage
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

        // If we are already connected (restored from local), maybe verify or skip?
        // If we want to force refresh or 'Silent login', prompts: ''
        // If user explicitly clicked "Connect/Sign In", we use 'consent' or empty.

        // Strategy: If we have a token (isConnected=true), we might just validate it by making a call.
        // But the user request said "Only login ONCE".
        // So:
        if (this.isConnected) {
            // Check validity by a simple call?
            // Or just do nothing and let them be.
            // If they are expired, the sync will fail. 
            // Better: Try to refresh silently on load.
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
            // If 401 or 403, our token is bad.
            if (err.status === 401 || err.status === 403) {
                this.isConnected = false;
                localStorage.removeItem('g_access_token');
                // Maybe trigger re-login logic or show status
                window.dispatchEvent(new CustomEvent('drive-disconnected'));
            }
        }
        return null;
    },

    async downloadFile() {
        if (!this.fileId) await this.findFile();
        if (!this.fileId) return null;

        try {
            const response = await gapi.client.drive.files.get({
                fileId: this.fileId,
                alt: 'media'
            });
            return response.body || response.result;
        } catch (err) {
            console.error("Download Error", err);
            return null;
        }
    },

    // --- 2. Fix File Name Logic (Multipart Upload) ---
    async saveFile(contentString) {
        if (!this.isConnected) return; // Silent fail if not connected

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
                // Update (PATCH) - Using upload URL is safer for content
                // Standard REST: PATCH https://www.googleapis.com/upload/drive/v3/files/fileId?uploadType=multipart

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
            console.log("Saved to Drive");
        } catch (err) {
            console.error("Save Error", err);
            // Handle Expiry
            if (err.status === 401) {
                this.isConnected = false;
                localStorage.removeItem('g_access_token');
            }
        }
    }
};
