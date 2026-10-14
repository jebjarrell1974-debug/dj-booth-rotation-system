import Configuration from './pages/Configuration';
import DJBooth from './pages/DJBooth';
import DancerView from './pages/DancerView';
import Landing from './pages/Landing';
import RotationDisplay from './pages/RotationDisplay';


export const PAGES = {
    "Configuration": Configuration,
    "DJBooth": DJBooth,
    "DancerView": DancerView,
    "Landing": Landing,
    "RotationDisplay": RotationDisplay,
}

export const pagesConfig = {
    mainPage: "Landing",
    Pages: PAGES,
};
