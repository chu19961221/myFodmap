export const DriveService = {
    codeClient: null,
    accessToken: null,
    tokenExpiry: 0,
    fileId: null,
    isConnected: false,
    lastSyncTime: null,
    _refreshPromise: null, // Track ongoing refresh

    // Storage Keys
    TOKEN_KEY: 'g_access_token',
    REFRESH_TOKEN_KEY: 'g_refresh_token',
    TOKEN_EXPIRY_KEY: 'g_token_expiry',

    getCredentials() {
        return {
            clientId: localStorage.getItem('g_client_id'),
            clientSecret: localStorage.getItem('g_client_secret'),
            apiKey: localStorage.getItem('g_api_key')
        };
    },

    getLastSyncTime() {
        return this.lastSyncTime;
    },

    getFormattedSyncTime() {
        if (!this.lastSyncTime) return null;
        return new Date(this.lastSyncTime).toLocaleString();
    },

    _storeTokenData(data) {
        const now = Date.now();
        // data.expires_in is in seconds, subtract small buffer (5 min) for safety
        const expiryTimestamp = now + ((data.expires_in - 300) * 1000);

        if (data.access_token) {
            this.accessToken = data.access_token;
            this.tokenExpiry = expiryTimestamp;
            localStorage.setItem(this.TOKEN_KEY, data.access_token);
            localStorage.setItem(this.TOKEN_EXPIRY_KEY, expiryTimestamp.toString());

            // Set for GAPI IMMEDIATE USE
            if (window.gapi && window.gapi.client) {
                window.gapi.client.setToken({ access_token: data.access_token });
            }
        }

        if (data.refresh_token) {
            localStorage.setItem(this.REFRESH_TOKEN_KEY, data.refresh_token);
        }

        this.isConnected = true;
        window.dispatchEvent(new CustomEvent('drive-connected'));
    },

    _loadStoredToken() {
        const token = localStorage.getItem(this.TOKEN_KEY);
        const expiry = localStorage.getItem(this.TOKEN_EXPIRY_KEY);
        const refresh = localStorage.getItem(this.REFRESH_TOKEN_KEY);

        if (token && expiry) {
            this.accessToken = token;
            this.tokenExpiry = parseInt(expiry, 10);

            if (this.isTokenValid()) {
                this.isConnected = true;
                if (window.gapi && window.gapi.client) {
                    window.gapi.client.setToken({ access_token: token });
                }
                return true;
            }
        }

        // Even if access token is invalid, if we have refresh token, we technically are "connected"
        // but need to refresh before next call.
        if (refresh) {
            this.isConnected = true;
            return false;
        }

        return false;
    },

    _clearStoredToken() {
        localStorage.removeItem(this.TOKEN_KEY);
        localStorage.removeItem(this.TOKEN_EXPIRY_KEY);
        localStorage.removeItem(this.REFRESH_TOKEN_KEY);
        this.accessToken = null;
        this.tokenExpiry = 0;
        this.isConnected = false;
    },

    isTokenValid() {
        if (!this.accessToken || !this.tokenExpiry) return false;
        return Date.now() < this.tokenExpiry;
    },

    async ensureValidToken() {
        if (this.isTokenValid()) {
            return true;
        }

        console.log('Token expired, attempting refresh...');
        const success = await this._refreshAccessToken();
        if (success) {
            console.log('Token refreshed successfully');
            return true;
        }

        console.log('Token refresh failed');
        return false;
    },

    async _refreshAccessToken() {
        if (this._refreshPromise) return this._refreshPromise;

        const refreshToken = localStorage.getItem(this.REFRESH_TOKEN_KEY);
        const { clientId, clientSecret } = this.getCredentials();

        if (!refreshToken || !clientId || !clientSecret) {
            console.error("Missing refresh token or credentials");
            return false;
        }

        this._refreshPromise = (async () => {
            try {
                const response = await fetch('https://oauth2.googleapis.com/token', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                    },
                    body: new URLSearchParams({
                        client_id: clientId,
                        client_secret: clientSecret,
                        refresh_token: refreshToken,
                        grant_type: 'refresh_token'
                    })
                });

                if (!response.ok) {
                    const error = await response.json();
                    console.error("Refresh failed:", error);
                    if (error.error === 'invalid_grant') {
                        // Refresh token revoked/expired
                        this._clearStoredToken();
                    }
                    return false;
                }

                const data = await response.json();
                this._storeTokenData(data);
                return true;

            } catch (err) {
                console.error("Refresh request error:", err);
                return false;
            } finally {
                this._refreshPromise = null;
            }
        })();

        return this._refreshPromise;
    },

    async _exchangeCodeForToken(code) {
        const { clientId, clientSecret } = this.getCredentials();

        try {
            const response = await fetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({
                    client_id: clientId,
                    client_secret: clientSecret,
                    code: code,
                    grant_type: 'authorization_code',
                    redirect_uri: 'postmessage' // REQUIRED for GIS popup flow
                })
            });

            if (!response.ok) {
                const err = await response.json();
                console.error("Exchange Token Error:", err);
                throw new Error("Failed to exchange code for token: " + (err.error_description || err.error));
            }

            const data = await response.json();
            console.log("Token exchanged successfully. Has Refresh Token?", !!data.refresh_token);
            this._storeTokenData(data);
            return true;

        } catch (err) {
            console.error("Exchange Exception:", err);
            return false;
        }
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

                // Check storage
                const hasValidToken = this._loadStoredToken();
                if (hasValidToken) {
                    console.log("Restored valid session");
                    window.dispatchEvent(new CustomEvent('drive-connected'));
                } else {
                    // Try refreshing if possible
                    const refreshToken = localStorage.getItem(this.REFRESH_TOKEN_KEY);
                    if (refreshToken) {
                        console.log("Found refresh token, attempting background refresh...");
                        const success = await this._refreshAccessToken();
                        if (!success) {
                            console.log("Background refresh failed, login needed.");
                        }
                    }
                }

                // Initialize GIS Code Client
                this.codeClient = google.accounts.oauth2.initCodeClient({
                    client_id: clientId,
                    scope: 'https://www.googleapis.com/auth/drive.file',
                    ux_mode: 'popup',
                    callback: async (response) => {
                        if (response.code) {
                            console.log("Auth Code received, exchanging...");
                            await this._exchangeCodeForToken(response.code);
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
        if (!this.codeClient) {
            await this.init();
        }

        // Force offline access to get Refresh Token
        // prompt: 'consent' is needed to ensure we get a refresh token
        this.codeClient.requestCode();
    },

    async findFile() {
        // Ensure token is valid before making API call
        const tokenValid = await this.ensureValidToken();
        if (!tokenValid) {
            throw new Error('AUTH_EXPIRED');
        }

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
                this._clearStoredToken();
                throw new Error('AUTH_EXPIRED');
            }
        }
        return null;
    },

    async downloadFile() {
        // Ensure token is valid before making API call
        const tokenValid = await this.ensureValidToken();
        if (!tokenValid) {
            throw new Error('AUTH_EXPIRED');
        }

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
                this._clearStoredToken();
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

        // Ensure token is valid before making API call
        const tokenValid = await this.ensureValidToken();
        if (!tokenValid) {
            throw new Error('AUTH_EXPIRED');
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
                this._clearStoredToken();
                throw new Error('AUTH_EXPIRED');
            }
            return false;
        }
    }
};
