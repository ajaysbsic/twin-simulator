import { AssemblyModel } from '../models/assembly.model';

export class SimulationEngine {
  private currentStep = 0;
  private activeComponents = new Set<string>();

  constructor(private assembly: AssemblyModel) {}

  canExecute(stepIndex: number): boolean {
  const step = this.assembly.steps[stepIndex];

  if (stepIndex !== this.currentStep) return false;

  const component = this.assembly.components.find(
    c => c.id === step.componentId
  );

  if (!component) return false;

  if (component.dependencies?.length) {
    return component.dependencies.every(dep =>
      this.activeComponents.has(dep)
    );
  }

  return true;
}

  getCurrentStep() {
    return this.currentStep;
  }

  execute(stepIndex: number): boolean {
    if (!this.canExecute(stepIndex)) return false;

    this.complete(stepIndex);

    return true;
  }

  complete(stepIndex: number): boolean {
    if (stepIndex !== this.currentStep) return false;

    const step = this.assembly.steps[stepIndex];

    if (step.action === 'attach') {
      this.activeComponents.add(step.componentId);
    } else {
      this.activeComponents.delete(step.componentId);
    }

    this.currentStep++;

    return true;
  }

  getState() {
    return {
      currentStep: this.currentStep,
      activeComponents: Array.from(this.activeComponents)
    };
  }
}
