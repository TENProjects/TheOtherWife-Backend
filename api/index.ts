/** @format */

import { App } from "../app.js";

const appInstance = new App();
await appInstance.initializeDb();

export default appInstance.app;
