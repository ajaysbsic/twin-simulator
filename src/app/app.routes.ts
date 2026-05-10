import { Routes } from '@angular/router';

import { DashboardComponent } from './dashboard/dashboard';
import { ViewerPageComponent } from './viewer-page/viewer-page';

export const routes: Routes = [
  {
    path: '',
    component: DashboardComponent
  },
  {
    path: 'viewer/:id',
    component: ViewerPageComponent
  }
];