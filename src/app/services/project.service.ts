import { Injectable } from '@angular/core';
import { ProjectModel } from '../models/project.model';

@Injectable({
  providedIn: 'root'
})
export class ProjectService {

  storageKey = 'twin-projects';

  getProjectById(id: string) {
    return this.getProjects().find(p => p.id === id);
  }

  getProjects(): ProjectModel[] {
    const data = localStorage.getItem(this.storageKey);

    return data ? JSON.parse(data) : [];
  }

  saveProjects(projects: ProjectModel[]) {
    localStorage.setItem(
      this.storageKey,
      JSON.stringify(projects)
    );
  }

  addProject(project: ProjectModel) {
    const projects = this.getProjects();

    projects.push(project);

    this.saveProjects(projects);
  }

  updateProject(project: ProjectModel) {
    const projects = this.getProjects()
      .map(p => p.id === project.id ? project : p);

    this.saveProjects(projects);
  }

  deleteProject(id: string) {
    const projects = this.getProjects()
      .filter(p => p.id !== id);

    this.saveProjects(projects);
  }
}
