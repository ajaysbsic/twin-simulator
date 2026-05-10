export interface ComponentModel {
  id: string;
  name: string;
  dependencies?: string[];
}

export interface StepModel {
  step: number;
  action: 'attach' | 'detach' | 'assemble';
  componentId: string;
}

export interface AssemblyModel {
  id: string;
  name: string;
  components: ComponentModel[];
  steps: StepModel[];
}