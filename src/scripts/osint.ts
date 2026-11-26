/**
 * One entry for the whole OSINT page, so the tabs, the map and the list share a single copy of
 * their state in one built file (the build allows no shared chunks). The tabs go first: they read
 * the address bar, and the map then starts from the type they found.
 */

import "./osint-tabs.ts";
import "./pivot-map.ts";
import "./all-tools.ts";
