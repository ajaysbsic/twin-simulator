import { Component, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HomeComponent } from '../home/home';
import { ViewerComponent } from '../viewer/viewer';
import { ProjectModel } from '../models/project.model';
import { ProjectService } from '../services/project.service';

@Component({
  selector: 'app-viewer-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    HomeComponent,
    ViewerComponent
  ],
  templateUrl: './viewer-page.html',
  styleUrl: './viewer-page.css',
})
export class ViewerPageComponent {

  projectId!: string;
  workspaceMode: 'simulation' | 'editor' = 'simulation';
  activeViewerMode: 'guided' | 'drag-drop' = 'guided';
  editorTransformMode: 'translate' | 'rotate' | 'scale' = 'translate';
  assemblyRotationEnabled = false;
  saveStatus = '';

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

    if (this.workspaceMode === 'editor' || this.assemblyRotationEnabled || this.isAutoAssemblyBusy) return;

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
    if (this.workspaceMode === 'editor') return;
    if (this.activeViewerMode === 'drag-drop') return;
    if (this.assemblyRotationEnabled) return;
    if (this.isAutoAssemblyBusy) return;

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

  onComponentDisassembled(componentId: string) {
    if (this.activeViewerMode !== 'drag-drop') return;

    this.assemblyRotationEnabled = false;
    this.home.undoStep(componentId);
  }

  onAssemblyExploded() {
    this.home.resetProgress();
  }

  get canUndoAssembly(): boolean {
    return this.workspaceMode === 'simulation' &&
      !!this.viewer?.canUndoLastAssembly();
  }

  get canRotateAssembly(): boolean {
    return this.workspaceMode === 'simulation' && !!this.viewer?.canRotateAssembly();
  }

  get canToggleAutoAssembly(): boolean {
    return this.workspaceMode === 'simulation' && !!this.viewer?.canToggleAutoAssembly();
  }

  get autoAssemblyLabel(): string {
    if (this.viewer?.isFullyAssembled) return 'Explode';
    return 'Assemble All';
  }

  get autoAssemblyProgress(): string {
    return this.viewer?.autoAssemblyProgress || '';
  }

  get isAutoAssemblyBusy(): boolean {
    return !!this.viewer?.isAutoAssembling || !!this.autoAssemblyProgress;
  }

  undoLastAssembly() {
    if (this.workspaceMode !== 'simulation') return;

    const componentId = this.viewer?.undoLastAssembly();

    if (componentId) {
      this.assemblyRotationEnabled = false;
      this.home.undoStep(componentId);
    }
  }

  toggleAssemblyRotation() {
    if (!this.canRotateAssembly) return;

    this.assemblyRotationEnabled = !this.assemblyRotationEnabled;
  }

  async toggleAutoAssembly() {
    if (!this.canToggleAutoAssembly) return;

    this.assemblyRotationEnabled = false;
    await this.viewer.toggleAutoAssembly();
  }

  setViewerMode(mode: 'guided' | 'drag-drop') {
    if (this.isAutoAssemblyBusy) return;
    if (this.activeViewerMode === mode) return;

    this.activeViewerMode = mode;
    this.assemblyRotationEnabled = false;
    this.home?.resetProgress();
  }

  setWorkspaceMode(mode: 'simulation' | 'editor') {
    if (this.isAutoAssemblyBusy) return;
    if (this.workspaceMode === mode) return;

    this.workspaceMode = mode;
    this.assemblyRotationEnabled = false;
    this.saveStatus = '';
    this.home?.resetProgress();
  }

  setEditorTransformMode(mode: 'translate' | 'rotate' | 'scale') {
    this.editorTransformMode = mode;
  }

  movePartOrder(index: number, direction: -1 | 1) {
    const targetIndex = index + direction;

    if (targetIndex < 0 || targetIndex >= this.project.models.length) return;

    const models = [...this.project.models];
    const [part] = models.splice(index, 1);
    models.splice(targetIndex, 0, part);

    this.project = {
      ...this.project,
      models: models.map((model, order) => ({
        ...model,
        id: `part-${order + 1}`,
        order
      }))
    };
    this.saveStatus = 'Order updated. Save Assembly to persist.';
  }

  generateExplodedView() {
    this.viewer?.applyExplodedView();
    this.saveStatus = 'Exploded layout generated. Save Assembly to persist.';
  }

  saveAssembly() {
    const models = this.viewer?.getEditedModels();

    if (!models?.length) {
      this.saveStatus = 'No editable parts are loaded yet.';
      return;
    }

    this.project = {
      ...this.project,
      models: models.map((model, order) => ({
        ...model,
        order
      }))
    };
    this.projectService.updateProject(this.project);
    this.home?.resetProgress();
    this.saveStatus = 'Assembly saved.';
  }
}
