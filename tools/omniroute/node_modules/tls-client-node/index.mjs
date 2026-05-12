import pkg from "./dist/index.js";

export const {
    ClientIdentifier,
    Emulation,
    CookieJar,
    MultipartForm,
    createMultipartForm,
    TLSClient,
    Session,
    fetch,
    TLSClientError,
    TLSResponse,
} = pkg;

export default pkg;