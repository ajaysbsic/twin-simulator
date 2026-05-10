import { Component, ViewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { HomeComponent } from '../home/home';
import { ViewerComponent } from '../viewer/viewer';
import { ProjectModel } from '../models/project.model';
import { ProjectService } from '../services/project.service';

@Component({
  selector: 'app-viewer-page',
  standalone: true,
  imports: [
    HomeComponent,
    ViewerComponent
  ],
  templateUrl: './viewer-page.html',
  styleUrl: './viewer-page.css',
})
export class ViewerPageComponent {

  projectId!: string;
  constructor(
    private projectService: ProjectService,
    private route: ActivatedRoute) {}

  @ViewChild(ViewerComponent)
  viewer!: ViewerComponent;

  @ViewChild(HomeComponent)
  home!: HomeComponent;

  project!: ProjectModel;
  
  ngOnInit() {
    this.projectId = this.route.snapshot.paramMap.get('id')!;

    this.project =
      this.projectService.getProjectById(this.projectId)!;
  }

  onStep(event: {
    success: boolean;
    componentId: string;
  }) {

    if (!this.viewer) return;

    if (event.success) {
      const started = this.viewer.attachComponent(event.componentId);

      if (!started) {
        this.viewer.markError(event.componentId);
      }
    } else {
      this.viewer.markError(event.componentId);
    }
  }

  onMeshClick(componentId: string) {

    const stepIndex =
      this.home.steps.findIndex(
        s => s.componentId === componentId
      );

    if (stepIndex !== -1) {
      this.home.executeStep(stepIndex);
    }
  }

  onComponentAssembled(componentId: string) {
    this.home.completeStep(componentId);
  }
}
