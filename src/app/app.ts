import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  template: `
    <router-outlet></router-outlet>
  `
})
export class App {}

// import { Component, ViewChild } from '@angular/core';
// import { DashboardComponent } from './dashboard/dashboard';
// import { HomeComponent } from './home/home';
// import { ViewerComponent } from './viewer/viewer';

// @Component({
//   selector: 'app-root',
//   standalone: true,
//   imports: [DashboardComponent, HomeComponent, ViewerComponent],
//   template: `
//       <div class="layout">

//         <div class="sidebar">
//           <app-home
//             (stepExecuted)="onStep($event)">
//           </app-home>
//         </div>

//         <div class="viewer-area">
//           <app-viewer
//             (meshClicked)="onMeshClick($event)">
//           </app-viewer>
//         </div>

//       </div>
//     `,
//     styleUrl: './app.css'
// })
// export class App {
//   @ViewChild(HomeComponent) home!: HomeComponent;
//   @ViewChild(ViewerComponent) viewer!: ViewerComponent;

//   onStep(event: { success: boolean; componentId: string }) {
//     if (!this.viewer) return;

//     if (event.success) {
//       this.viewer.attachComponent(event.componentId);
//     } else {
//       this.viewer.markError(event.componentId);
//     }
//   }

//   onMeshClick(componentId: string) {
//     // find step index
//     const stepIndex = this.home.steps.findIndex(
//       s => s.componentId === componentId
//     );

//     if (stepIndex !== -1) {
//       this.home.executeStep(stepIndex);
//     }
//   }
// }