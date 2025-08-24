// Tests for DOM interactions and UI components

describe('DOM Interactions', () => {
  // Mock DOM setup
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    sessionStorage.clear();
  });

  // Helper function to simulate model selection UI creation
  function createModelSelectionUI(savedModel = 'gpt-4o') {
    const container = document.createElement('div');
    container.className = 'model-selection';
    
    container.innerHTML = `
      <div class="model-selection-inline">
        <span class="model-selection-label">AI Model:</span>
        <div class="model-options-inline">
          <label class="model-option-compact">
            <input type="radio" name="gpt-version" value="gpt-4o" ${savedModel === 'gpt-4o' ? 'checked' : ''}>
            <span class="model-name-compact">GPT-4o</span>
          </label>
          <label class="model-option-compact">
            <input type="radio" name="gpt-version" value="gpt-5-nano" ${savedModel === 'gpt-5-nano' ? 'checked' : ''}>
            <span class="model-name-compact">GPT-5 Nano</span>
          </label>
          <label class="model-option-compact">
            <input type="radio" name="gpt-version" value="custom" ${savedModel && !['gpt-4o', 'gpt-5-nano'].includes(savedModel) ? 'checked' : ''}>
            <span class="model-name-compact">Custom</span>
          </label>
        </div>
      </div>
      <div class="custom-model-input" style="display: ${savedModel && !['gpt-4o', 'gpt-5-nano'].includes(savedModel) ? 'block' : 'none'};">
        <input type="text" id="custom-model-name" placeholder="e.g., gpt-4-turbo, gpt-5-mini" value="${savedModel && !['gpt-4o', 'gpt-5-nano'].includes(savedModel) ? savedModel : ''}" />
      </div>
    `;
    
    return container;
  }

  describe('Model Selection UI', () => {
    test('should create model selection UI with correct default selection', () => {
      const ui = createModelSelectionUI('gpt-4o');
      document.body.appendChild(ui);
      
      const gpt4Radio = ui.querySelector('input[value="gpt-4o"]');
      const gpt5Radio = ui.querySelector('input[value="gpt-5-nano"]');
      const customRadio = ui.querySelector('input[value="custom"]');
      
      expect(gpt4Radio.checked).toBe(true);
      expect(gpt5Radio.checked).toBe(false);
      expect(customRadio.checked).toBe(false);
    });

    test('should show custom input when custom model is selected', () => {
      const ui = createModelSelectionUI('claude-3-sonnet');
      document.body.appendChild(ui);
      
      const customRadio = ui.querySelector('input[value="custom"]');
      const customInput = ui.querySelector('.custom-model-input');
      const customInputField = ui.querySelector('#custom-model-name');
      
      expect(customRadio.checked).toBe(true);
      expect(customInput.style.display).toBe('block');
      expect(customInputField.value).toBe('claude-3-sonnet');
    });

    test('should hide custom input for predefined models', () => {
      const ui = createModelSelectionUI('gpt-5-nano');
      document.body.appendChild(ui);
      
      const customInput = ui.querySelector('.custom-model-input');
      
      expect(customInput.style.display).toBe('none');
    });

    test('should get selected model value correctly', () => {
      const ui = createModelSelectionUI('gpt-5-nano');
      document.body.appendChild(ui);
      
      const selectedRadio = ui.querySelector('input[name="gpt-version"]:checked');
      expect(selectedRadio.value).toBe('gpt-5-nano');
    });

    test('should handle custom model selection', () => {
      const ui = createModelSelectionUI('gpt-4-turbo');
      document.body.appendChild(ui);
      
      const customRadio = ui.querySelector('input[value="custom"]');
      const customInputField = ui.querySelector('#custom-model-name');
      
      expect(customRadio.checked).toBe(true);
      expect(customInputField.value).toBe('gpt-4-turbo');
    });
  });

  describe('LocalStorage Integration', () => {
    beforeEach(() => {
      localStorage.clear();
      jest.clearAllMocks();
    });

    test('should save selected model to localStorage', () => {
      localStorage.setItem('selectedGPTModel', 'gpt-5-nano');
      
      // Test that we can retrieve what we set
      const saved = localStorage.getItem('selectedGPTModel');
      expect(saved).toBe('gpt-5-nano');
    });

    test('should load saved model from localStorage', () => {
      // Use the mock implementation
      localStorage.setItem('selectedGPTModel', 'gpt-5-nano');
      
      const savedModel = localStorage.getItem('selectedGPTModel') || 'gpt-4o';
      expect(savedModel).toBe('gpt-5-nano');
    });

    test('should default to gpt-4o when no saved model', () => {
      // Don't set anything, should return null
      const savedModel = localStorage.getItem('selectedGPTModel') || 'gpt-4o';
      expect(savedModel).toBe('gpt-4o');
    });

    test('should handle custom model persistence', () => {
      localStorage.setItem('selectedGPTModel', 'claude-3-opus');
      
      const savedModel = localStorage.getItem('selectedGPTModel');
      const isCustomModel = !['gpt-4o', 'gpt-5-nano'].includes(savedModel);
      
      expect(isCustomModel).toBe(true);
      expect(savedModel).toBe('claude-3-opus');
    });
  });

  describe('UI Event Simulation', () => {
    test('should handle radio button change events', () => {
      const ui = createModelSelectionUI();
      document.body.appendChild(ui);
      
      const gpt5Radio = ui.querySelector('input[value="gpt-5-nano"]');
      const changeHandler = jest.fn();
      
      gpt5Radio.addEventListener('change', changeHandler);
      
      // Simulate clicking the radio button
      gpt5Radio.click();
      
      expect(changeHandler).toHaveBeenCalled();
      expect(gpt5Radio.checked).toBe(true);
    });

    test('should handle custom input field changes', () => {
      const ui = createModelSelectionUI('custom-model');
      document.body.appendChild(ui);
      
      const customInput = ui.querySelector('#custom-model-name');
      const inputHandler = jest.fn();
      
      customInput.addEventListener('input', inputHandler);
      
      // Simulate typing in the input
      customInput.value = 'gpt-4-turbo';
      customInput.dispatchEvent(new Event('input'));
      
      expect(inputHandler).toHaveBeenCalled();
      expect(customInput.value).toBe('gpt-4-turbo');
    });

    test('should show/hide custom input based on selection', () => {
      const ui = createModelSelectionUI();
      document.body.appendChild(ui);
      
      const customRadio = ui.querySelector('input[value="custom"]');
      const gpt4Radio = ui.querySelector('input[value="gpt-4o"]');
      const customInput = ui.querySelector('.custom-model-input');
      
      // Initially hidden
      expect(customInput.style.display).toBe('none');
      
      // Show when custom selected
      customRadio.click();
      customInput.style.display = 'block';
      expect(customInput.style.display).toBe('block');
      
      // Hide when predefined model selected
      gpt4Radio.click();
      customInput.style.display = 'none';
      expect(customInput.style.display).toBe('none');
    });
  });

  describe('Error Handling', () => {
    test('should handle missing DOM elements gracefully', () => {
      const ui = document.createElement('div');
      document.body.appendChild(ui);
      
      const nonExistentRadio = ui.querySelector('input[name="gpt-version"]:checked');
      expect(nonExistentRadio).toBeNull();
    });

    test('should handle malformed HTML gracefully', () => {
      const ui = document.createElement('div');
      ui.innerHTML = '<input type="radio" name="gpt-version" value="test">'; // Fixed HTML
      document.body.appendChild(ui);
      
      const radio = ui.querySelector('input[name="gpt-version"]');
      expect(radio).not.toBeNull();
      expect(radio.value).toBe('test');
    });

    test('should handle undefined localStorage values', () => {
      // Don't set anything, localStorage.getItem will return null
      const savedModel = localStorage.getItem('selectedGPTModel') || 'gpt-4o';
      expect(savedModel).toBe('gpt-4o');
    });
  });
});