import React from "react";
import { Admin, Resource, defaultLightTheme, defaultDarkTheme } from "react-admin";
import { Code, FolderOpen, People, Sync } from "@mui/icons-material";
import { dataProvider } from "./dataProvider";
import { authProvider } from "./authProvider";
import { CustomLayout } from "./Layout";

import * as users from "./users";
import * as blobs from "./blobs";
import * as rules from "./rules";
import FullSyncPage from "./sync/FullSyncPage";

export const App = () => (
  <Admin
    dataProvider={dataProvider}
    authProvider={authProvider}
    disableTelemetry
    lightTheme={defaultLightTheme}
    darkTheme={defaultDarkTheme}
    defaultTheme="dark"
    layout={CustomLayout}
  >
    <Resource name="blobs" icon={FolderOpen} {...blobs} />
    <Resource name="users" icon={People} {...users} />
    <Resource name="rules" icon={Code} {...rules} />
    <Resource name="sync" options={{ label: "Full Sync" }} icon={Sync} list={FullSyncPage} />
  </Admin>
);
