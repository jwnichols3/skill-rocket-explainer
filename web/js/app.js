import { registerRoute, startRouter } from './router.js';
import { homeView } from './views/home.js';
import { explainersView } from './views/explainers.js';
import './views/styles.js';
import './views/explainer.js';
import './views/output.js';
import { settingsView } from './views/settings.js';
import { newExplainerView } from './views/new-explainer.js';

registerRoute(/^\/$/, homeView);
registerRoute(/^\/new$/, newExplainerView);
registerRoute(/^\/explainers$/, explainersView);
registerRoute(/^\/settings$/, settingsView);
startRouter();
