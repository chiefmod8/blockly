/**
 * @license
 * Copyright 2012 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Dropdown input field.  Used for editable titles and variables.
 * In the interests of a consistent UI, the toolbox shares some functions and
 * properties with the context menu.
 *
 * @class
 */
import * as goog from '../closure/goog/goog.js';
goog.declareModuleId('Blockly.FieldDropdown');

import type {BlockSvg} from './block_svg.js';
import * as dropDownDiv from './dropdowndiv.js';
import {Field, FieldConfig, FieldValidator, UnattachedFieldError} from './field.js';
import * as fieldRegistry from './field_registry.js';
import {Menu} from './menu.js';
import {MenuItem} from './menuitem.js';
import * as aria from './utils/aria.js';
import {Coordinate} from './utils/coordinate.js';
import * as dom from './utils/dom.js';
import * as parsing from './utils/parsing.js';
import type {Sentinel} from './utils/sentinel.js';
import * as utilsString from './utils/string.js';
import {Svg} from './utils/svg.js';

export type FieldDropdownValidator = FieldValidator<string>;

/**
 * Class for an editable dropdown field.
 *
 * @alias Blockly.FieldDropdown
 */
export class FieldDropdown extends Field<string> {
  /** Horizontal distance that a checkmark overhangs the dropdown. */
  static CHECKMARK_OVERHANG = 25;

  /**
   * Maximum height of the dropdown menu, as a percentage of the viewport
   * height.
   */
  static MAX_MENU_HEIGHT_VH = 0.45;

  static ARROW_CHAR = '▾';

  /** A reference to the currently selected menu item. */
  private selectedMenuItem_: MenuItem|null = null;

  /** The dropdown menu. */
  protected menu_: Menu|null = null;

  /**
   * SVG image element if currently selected option is an image, or null.
   */
  private imageElement_: SVGImageElement|null = null;

  /** Tspan based arrow element. */
  private arrow_: SVGTSpanElement|null = null;

  /** SVG based arrow element. */
  private svgArrow_: SVGElement|null = null;

  /**
   * Serializable fields are saved by the serializer, non-serializable fields
   * are not. Editable fields should also be serializable.
   */
  override SERIALIZABLE = true;

  /** Mouse cursor style when over the hotspot that initiates the editor. */
  override CURSOR = 'default';

  protected menuGenerator_?: MenuGenerator;

  /** A cache of the most recently generated options. */
  private generatedOptions_: MenuOption[]|null = null;

  /**
   * The prefix field label, of common words set after options are trimmed.
   *
   * @internal
   */
  override prefixField: string|null = null;

  /**
   * The suffix field label, of common words set after options are trimmed.
   *
   * @internal
   */
  override suffixField: string|null = null;
  // TODO(b/109816955): remove '!', see go/strict-prop-init-fix.
  private selectedOption_!: MenuOption;
  override clickTarget_: SVGElement|null = null;

  /**
   * @param menuGenerator A non-empty array of options for a dropdown list, or a
   *     function which generates these options. Also accepts Field.SKIP_SETUP
   *     if you wish to skip setup (only used by subclasses that want to handle
   *     configuration and setting the field value after their own constructors
   *     have run).
   * @param opt_validator A function that is called to validate changes to the
   *     field's value. Takes in a language-neutral dropdown option & returns a
   *     validated language-neutral dropdown option, or null to abort the
   *     change.
   * @param opt_config A map of options used to configure the field.
   *     See the [field creation documentation]{@link
   * https://developers.google.com/blockly/guides/create-custom-blocks/fields/built-in-fields/dropdown#creation}
   * for a list of properties this parameter supports.
   * @throws {TypeError} If `menuGenerator` options are incorrectly structured.
   */
  constructor(
      menuGenerator: MenuGenerator,
      opt_validator?: FieldDropdownValidator,
      opt_config?: FieldConfig,
  );
  constructor(menuGenerator: Sentinel);
  constructor(
      menuGenerator: MenuGenerator|Sentinel,
      opt_validator?: FieldDropdownValidator,
      opt_config?: FieldConfig,
  ) {
    super(Field.SKIP_SETUP);

    // If we pass SKIP_SETUP, don't do *anything* with the menu generator.
    if (!isMenuGenerator(menuGenerator)) return;

    if (Array.isArray(menuGenerator)) {
      validateOptions(menuGenerator);
      const trimmed = trimOptions(menuGenerator);
      this.menuGenerator_ = trimmed.options;
      this.prefixField = trimmed.prefix || null;
      this.suffixField = trimmed.suffix || null;
    } else {
      this.menuGenerator_ = menuGenerator;
    }

    /**
     * The currently selected option. The field is initialized with the
     * first option selected.
     */
    this.selectedOption_ = this.getOptions(false)[0];

    if (opt_config) {
      this.configure_(opt_config);
    }
    this.setValue(this.selectedOption_[1]);
    if (opt_validator) {
      this.setValidator(opt_validator);
    }
  }

  /**
   * Sets the field's value based on the given XML element. Should only be
   * called by Blockly.Xml.
   *
   * @param fieldElement The element containing info about the field's state.
   * @internal
   */
  override fromXml(fieldElement: Element) {
    if (this.isOptionListDynamic()) {
      this.getOptions(false);
    }
    this.setValue(fieldElement.textContent);
  }

  /**
   * Sets the field's value based on the given state.
   *
   * @param state The state to apply to the dropdown field.
   * @internal
   */
  override loadState(state: AnyDuringMigration) {
    if (this.loadLegacyState(FieldDropdown, state)) {
      return;
    }
    if (this.isOptionListDynamic()) {
      this.getOptions(false);
    }
    this.setValue(state);
  }

  /**
   * Create the block UI for this dropdown.
   *
   * @internal
   */
  override initView() {
    if (this.shouldAddBorderRect_()) {
      this.createBorderRect_();
    } else {
      this.clickTarget_ = (this.sourceBlock_ as BlockSvg).getSvgRoot();
    }
    this.createTextElement_();

    this.imageElement_ = dom.createSvgElement(Svg.IMAGE, {}, this.fieldGroup_);

    if (this.getConstants()!.FIELD_DROPDOWN_SVG_ARROW) {
      this.createSVGArrow_();
    } else {
      this.createTextArrow_();
    }

    if (this.borderRect_) {
      dom.addClass(this.borderRect_, 'blocklyDropdownRect');
    }
  }

  /**
   * Whether or not the dropdown should add a border rect.
   *
   * @returns True if the dropdown field should add a border rect.
   */
  protected shouldAddBorderRect_(): boolean {
    return !this.getConstants()!.FIELD_DROPDOWN_NO_BORDER_RECT_SHADOW ||
        this.getConstants()!.FIELD_DROPDOWN_NO_BORDER_RECT_SHADOW &&
        !this.getSourceBlock()?.isShadow();
  }

  /** Create a tspan based arrow. */
  protected createTextArrow_() {
    this.arrow_ = dom.createSvgElement(Svg.TSPAN, {}, this.textElement_);
    this.arrow_!.appendChild(document.createTextNode(
        this.getSourceBlock()?.RTL ? FieldDropdown.ARROW_CHAR + ' ' :
                                     ' ' + FieldDropdown.ARROW_CHAR));
    if (this.getSourceBlock()?.RTL) {
      this.getTextElement().insertBefore(this.arrow_, this.textContent_);
    } else {
      this.getTextElement().appendChild(this.arrow_);
    }
  }

  /** Create an SVG based arrow. */
  protected createSVGArrow_() {
    this.svgArrow_ = dom.createSvgElement(
        Svg.IMAGE, {
          'height': this.getConstants()!.FIELD_DROPDOWN_SVG_ARROW_SIZE + 'px',
          'width': this.getConstants()!.FIELD_DROPDOWN_SVG_ARROW_SIZE + 'px',
        },
        this.fieldGroup_);
    this.svgArrow_!.setAttributeNS(
        dom.XLINK_NS, 'xlink:href',
        this.getConstants()!.FIELD_DROPDOWN_SVG_ARROW_DATAURI);
  }

  /**
   * Create a dropdown menu under the text.
   *
   * @param opt_e Optional mouse event that triggered the field to open, or
   *     undefined if triggered programmatically.
   */
  protected override showEditor_(opt_e?: MouseEvent) {
    const block = this.getSourceBlock();
    if (!block) {
      throw new UnattachedFieldError();
    }
    this.dropdownCreate_();
    if (opt_e && typeof opt_e.clientX === 'number') {
      this.menu_!.openingCoords = new Coordinate(opt_e.clientX, opt_e.clientY);
    } else {
      this.menu_!.openingCoords = null;
    }

    // Remove any pre-existing elements in the dropdown.
    dropDownDiv.clearContent();
    // Element gets created in render.
    const menuElement = this.menu_!.render(dropDownDiv.getContentDiv());
    dom.addClass(menuElement, 'blocklyDropdownMenu');

    if (this.getConstants()!.FIELD_DROPDOWN_COLOURED_DIV) {
      const primaryColour =
          block.isShadow() ? block.getParent()!.getColour() : block.getColour();
      const borderColour = block.isShadow() ?
          (block.getParent() as BlockSvg).style.colourTertiary :
          (this.sourceBlock_ as BlockSvg).style.colourTertiary;
      dropDownDiv.setColour(primaryColour, borderColour);
    }

    dropDownDiv.showPositionedByField(this, this.dropdownDispose_.bind(this));

    // Focusing needs to be handled after the menu is rendered and positioned.
    // Otherwise it will cause a page scroll to get the misplaced menu in
    // view. See issue #1329.
    this.menu_!.focus();

    if (this.selectedMenuItem_) {
      this.menu_!.setHighlighted(this.selectedMenuItem_);
    }

    this.applyColour();
  }

  /** Create the dropdown editor. */
  private dropdownCreate_() {
    const block = this.getSourceBlock();
    if (!block) {
      throw new UnattachedFieldError();
    }
    const menu = new Menu();
    menu.setRole(aria.Role.LISTBOX);
    this.menu_ = menu;

    const options = this.getOptions(false);
    this.selectedMenuItem_ = null;
    for (let i = 0; i < options.length; i++) {
      const [label, value] = options[i];
      const content = (() => {
        if (typeof label === 'object') {
          // Convert ImageProperties to an HTMLImageElement.
          const image = new Image(label['width'], label['height']);
          image.src = label['src'];
          image.alt = label['alt'] || '';
          return image;
        }
        return label;
      })();
      const menuItem = new MenuItem(content, value);
      menuItem.setRole(aria.Role.OPTION);
      menuItem.setRightToLeft(block.RTL);
      menuItem.setCheckable(true);
      menu.addChild(menuItem);
      menuItem.setChecked(value === this.value_);
      if (value === this.value_) {
        this.selectedMenuItem_ = menuItem;
      }
      menuItem.onAction(this.handleMenuActionEvent_, this);
    }
  }

  /**
   * Disposes of events and DOM-references belonging to the dropdown editor.
   */
  private dropdownDispose_() {
    if (this.menu_) {
      this.menu_.dispose();
    }
    this.menu_ = null;
    this.selectedMenuItem_ = null;
    this.applyColour();
  }

  /**
   * Handle an action in the dropdown menu.
   *
   * @param menuItem The MenuItem selected within menu.
   */
  private handleMenuActionEvent_(menuItem: MenuItem) {
    dropDownDiv.hideIfOwner(this, true);
    this.onItemSelected_(this.menu_ as Menu, menuItem);
  }

  /**
   * Handle the selection of an item in the dropdown menu.
   *
   * @param menu The Menu component clicked.
   * @param menuItem The MenuItem selected within menu.
   */
  protected onItemSelected_(menu: Menu, menuItem: MenuItem) {
    this.setValue(menuItem.getValue());
  }

  /**
   * @returns True if the option list is generated by a function.
   *     Otherwise false.
   */
  isOptionListDynamic(): boolean {
    return typeof this.menuGenerator_ === 'function';
  }

  /**
   * Return a list of the options for this dropdown.
   *
   * @param opt_useCache For dynamic options, whether or not to use the cached
   *     options or to re-generate them.
   * @returns A non-empty array of option tuples:
   *     (human-readable text or image, language-neutral name).
   * @throws {TypeError} If generated options are incorrectly structured.
   */
  getOptions(opt_useCache?: boolean): MenuOption[] {
    if (!this.menuGenerator_) {
      // A subclass improperly skipped setup without defining the menu
      // generator.
      throw TypeError('A menu generator was never defined.');
    }
    if (Array.isArray(this.menuGenerator_)) return this.menuGenerator_;
    if (opt_useCache && this.generatedOptions_) return this.generatedOptions_;

    this.generatedOptions_ = this.menuGenerator_();
    validateOptions(this.generatedOptions_);
    return this.generatedOptions_;
  }

  /**
   * Ensure that the input value is a valid language-neutral option.
   *
   * @param opt_newValue The input value.
   * @returns A valid language-neutral option, or null if invalid.
   */
  protected override doClassValidation_(opt_newValue?: string): string|null {
    const options = this.getOptions(true);
    const isValueValid = options.some((option) => option[1] === opt_newValue);

    if (!isValueValid) {
      if (this.sourceBlock_) {
        console.warn(
            'Cannot set the dropdown\'s value to an unavailable option.' +
            ' Block type: ' + this.sourceBlock_.type +
            ', Field name: ' + this.name + ', Value: ' + opt_newValue);
      }
      return null;
    }
    return opt_newValue as string;
  }

  /**
   * Update the value of this dropdown field.
   *
   * @param newValue The value to be saved. The default validator guarantees
   *     that this is one of the valid dropdown options.
   */
  protected override doValueUpdate_(newValue: string) {
    super.doValueUpdate_(newValue);
    const options = this.getOptions(true);
    for (let i = 0, option; option = options[i]; i++) {
      if (option[1] === this.value_) {
        this.selectedOption_ = option;
      }
    }
  }

  /**
   * Updates the dropdown arrow to match the colour/style of the block.
   *
   * @internal
   */
  override applyColour() {
    const style = (this.sourceBlock_ as BlockSvg).style;
    if (this.borderRect_) {
      this.borderRect_.setAttribute('stroke', style.colourTertiary);
      if (this.menu_) {
        this.borderRect_.setAttribute('fill', style.colourTertiary);
      } else {
        this.borderRect_.setAttribute('fill', 'transparent');
      }
    }
    // Update arrow's colour.
    if (this.sourceBlock_ && this.arrow_) {
      if (this.sourceBlock_.isShadow()) {
        this.arrow_.style.fill = style.colourSecondary;
      } else {
        this.arrow_.style.fill = style.colourPrimary;
      }
    }
  }

  /** Draws the border with the correct width. */
  protected override render_() {
    // Hide both elements.
    this.getTextContent().nodeValue = '';
    this.imageElement_!.style.display = 'none';

    // Show correct element.
    const option = this.selectedOption_ && this.selectedOption_[0];
    if (option && typeof option === 'object') {
      this.renderSelectedImage_(option);
    } else {
      this.renderSelectedText_();
    }

    this.positionBorderRect_();
  }

  /**
   * Renders the selected option, which must be an image.
   *
   * @param imageJson Selected option that must be an image.
   */
  private renderSelectedImage_(imageJson: ImageProperties) {
    const block = this.getSourceBlock();
    if (!block) {
      throw new UnattachedFieldError();
    }
    this.imageElement_!.style.display = '';
    this.imageElement_!.setAttributeNS(
        dom.XLINK_NS, 'xlink:href', imageJson.src);
    this.imageElement_!.setAttribute('height', `${imageJson.height}`);
    this.imageElement_!.setAttribute('width', `${imageJson.width}`);

    const imageHeight = Number(imageJson.height);
    const imageWidth = Number(imageJson.width);

    // Height and width include the border rect.
    const hasBorder = !!this.borderRect_;
    const height = Math.max(
        hasBorder ? this.getConstants()!.FIELD_DROPDOWN_BORDER_RECT_HEIGHT : 0,
        imageHeight + IMAGE_Y_PADDING);
    const xPadding =
        hasBorder ? this.getConstants()!.FIELD_BORDER_RECT_X_PADDING : 0;
    let arrowWidth = 0;
    if (this.svgArrow_) {
      arrowWidth = this.positionSVGArrow_(
          imageWidth + xPadding,
          height / 2 - this.getConstants()!.FIELD_DROPDOWN_SVG_ARROW_SIZE / 2);
    } else {
      arrowWidth = dom.getFastTextWidth(
          this.arrow_ as SVGTSpanElement,
          this.getConstants()!.FIELD_TEXT_FONTSIZE,
          this.getConstants()!.FIELD_TEXT_FONTWEIGHT,
          this.getConstants()!.FIELD_TEXT_FONTFAMILY);
    }
    this.size_.width = imageWidth + arrowWidth + xPadding * 2;
    this.size_.height = height;

    let arrowX = 0;
    if (block.RTL) {
      const imageX = xPadding + arrowWidth;
      this.imageElement_!.setAttribute('x', imageX.toString());
    } else {
      arrowX = imageWidth + arrowWidth;
      this.getTextElement().setAttribute('text-anchor', 'end');
      this.imageElement_!.setAttribute('x', xPadding.toString());
    }
    this.imageElement_!.setAttribute(
        'y', (height / 2 - imageHeight / 2).toString());

    this.positionTextElement_(arrowX + xPadding, imageWidth + arrowWidth);
  }

  /** Renders the selected option, which must be text. */
  private renderSelectedText_() {
    // Retrieves the selected option to display through getText_.
    this.getTextContent().nodeValue = this.getDisplayText_();
    const textElement = this.getTextElement();
    dom.addClass(textElement, 'blocklyDropdownText');
    textElement.setAttribute('text-anchor', 'start');

    // Height and width include the border rect.
    const hasBorder = !!this.borderRect_;
    const height = Math.max(
        hasBorder ? this.getConstants()!.FIELD_DROPDOWN_BORDER_RECT_HEIGHT : 0,
        this.getConstants()!.FIELD_TEXT_HEIGHT);
    const textWidth = dom.getFastTextWidth(
        this.getTextElement(), this.getConstants()!.FIELD_TEXT_FONTSIZE,
        this.getConstants()!.FIELD_TEXT_FONTWEIGHT,
        this.getConstants()!.FIELD_TEXT_FONTFAMILY);
    const xPadding =
        hasBorder ? this.getConstants()!.FIELD_BORDER_RECT_X_PADDING : 0;
    let arrowWidth = 0;
    if (this.svgArrow_) {
      arrowWidth = this.positionSVGArrow_(
          textWidth + xPadding,
          height / 2 - this.getConstants()!.FIELD_DROPDOWN_SVG_ARROW_SIZE / 2);
    }
    this.size_.width = textWidth + arrowWidth + xPadding * 2;
    this.size_.height = height;

    this.positionTextElement_(xPadding, textWidth);
  }

  /**
   * Position a drop-down arrow at the appropriate location at render-time.
   *
   * @param x X position the arrow is being rendered at, in px.
   * @param y Y position the arrow is being rendered at, in px.
   * @returns Amount of space the arrow is taking up, in px.
   */
  private positionSVGArrow_(x: number, y: number): number {
    if (!this.svgArrow_) {
      return 0;
    }
    const block = this.getSourceBlock();
    if (!block) {
      throw new UnattachedFieldError();
    }
    const hasBorder = !!this.borderRect_;
    const xPadding =
        hasBorder ? this.getConstants()!.FIELD_BORDER_RECT_X_PADDING : 0;
    const textPadding = this.getConstants()!.FIELD_DROPDOWN_SVG_ARROW_PADDING;
    const svgArrowSize = this.getConstants()!.FIELD_DROPDOWN_SVG_ARROW_SIZE;
    const arrowX = block.RTL ? xPadding : x + textPadding;
    this.svgArrow_.setAttribute(
        'transform', 'translate(' + arrowX + ',' + y + ')');
    return svgArrowSize + textPadding;
  }

  /**
   * Use the `getText_` developer hook to override the field's text
   * representation.  Get the selected option text. If the selected option is an
   * image we return the image alt text.
   *
   * @returns Selected option text.
   */
  protected override getText_(): string|null {
    if (!this.selectedOption_) {
      return null;
    }
    const option = this.selectedOption_[0];
    if (typeof option === 'object') {
      return option['alt'];
    }
    return option;
  }

  /**
   * Construct a FieldDropdown from a JSON arg object.
   *
   * @param options A JSON object with options (options).
   * @returns The new field instance.
   * @nocollapse
   * @internal
   */
  static fromJson(options: FieldDropdownFromJsonConfig): FieldDropdown {
    if (!options.options) {
      throw new Error(
          'options are required for the dropdown field. The ' +
          'options property must be assigned an array of ' +
          '[humanReadableValue, languageNeutralValue] tuples.');
    }
    // `this` might be a subclass of FieldDropdown if that class doesn't
    // override the static fromJson method.
    return new this(options.options, undefined, options);
  }
}

/**
 * Definition of a human-readable image dropdown option.
 */
export interface ImageProperties {
  src: string;
  alt: string;
  width: number;
  height: number;
}

/**
 * An individual option in the dropdown menu. The first element is the human-
 * readable value (text or image), and the second element is the language-
 * neutral value.
 */
export type MenuOption = [string | ImageProperties, string];

/**
 * A function that generates an array of menu options for FieldDropdown
 * or its descendants.
 */
export type MenuGeneratorFunction = (this: FieldDropdown) => MenuOption[];

/**
 * Either an array of menu options or a function that generates an array of
 * menu options for FieldDropdown or its descendants.
 */
export type MenuGenerator = MenuOption[]|MenuGeneratorFunction;

/**
 * fromJson config for the dropdown field.
 */
export interface FieldDropdownFromJsonConfig extends FieldConfig {
  options?: MenuOption[];
}

/**
 * The y offset from the top of the field to the top of the image, if an image
 * is selected.
 */
const IMAGE_Y_OFFSET = 5;

/** The total vertical padding above and below an image. */
const IMAGE_Y_PADDING: number = IMAGE_Y_OFFSET * 2;

/**
 * NOTE: Because Sentinel is an empty class, proving a value is Sentinel does
 * not resolve in TS that it isn't a MenuGenerator.
 */
function isMenuGenerator(menuGenerator: MenuGenerator|
                         Sentinel): menuGenerator is MenuGenerator {
  return menuGenerator !== Field.SKIP_SETUP;
}

/**
 * Factor out common words in statically defined options.
 * Create prefix and/or suffix labels.
 */
function trimOptions(options: MenuOption[]):
    {options: MenuOption[]; prefix?: string; suffix?: string;} {
  let hasImages = false;
  const trimmedOptions = options.map(([label, value]): MenuOption => {
    if (typeof label === 'string') {
      return [parsing.replaceMessageReferences(label), value];
    }

    hasImages = true;
    // Copy the image properties so they're not influenced by the original.
    // NOTE: No need to deep copy since image properties are only 1 level deep.
    const imageLabel = label.alt !== null ?
        {...label, alt: parsing.replaceMessageReferences(label.alt)} :
        {...label};
    return [imageLabel, value];
  });

  if (hasImages || options.length < 2) return {options: trimmedOptions};

  const stringOptions = trimmedOptions as [string, string][];
  const stringLabels = stringOptions.map(([label]) => label);

  const shortest = utilsString.shortestStringLength(stringLabels);
  const prefixLength = utilsString.commonWordPrefix(stringLabels, shortest);
  const suffixLength = utilsString.commonWordSuffix(stringLabels, shortest);

  if ((!prefixLength && !suffixLength) ||
      (shortest <= prefixLength + suffixLength)) {
    // One or more strings will entirely vanish if we proceed.  Abort.
    return {options: stringOptions};
  }

  const prefix =
      prefixLength ? stringLabels[0].substring(0, prefixLength - 1) : undefined;
  const suffix =
      suffixLength ? stringLabels[0].substr(1 - suffixLength) : undefined;
  return {
    options: applyTrim(stringOptions, prefixLength, suffixLength),
    prefix,
    suffix,
  };
}

/**
 * Use the calculated prefix and suffix lengths to trim all of the options in
 * the given array.
 *
 * @param options Array of option tuples:
 *     (human-readable text or image, language-neutral name).
 * @param prefixLength The length of the common prefix.
 * @param suffixLength The length of the common suffix
 * @returns A new array with all of the option text trimmed.
 */
function applyTrim(
    options: [string, string][], prefixLength: number,
    suffixLength: number): MenuOption[] {
  return options.map(
      ([text, value]) =>
          [text.substring(prefixLength, text.length - suffixLength),
           value,
  ]);
}

/**
 * Validates the data structure to be processed as an options list.
 *
 * @param options The proposed dropdown options.
 * @throws {TypeError} If proposed options are incorrectly structured.
 */
function validateOptions(options: MenuOption[]) {
  if (!Array.isArray(options)) {
    throw TypeError('FieldDropdown options must be an array.');
  }
  if (!options.length) {
    throw TypeError('FieldDropdown options must not be an empty array.');
  }
  let foundError = false;
  for (let i = 0; i < options.length; i++) {
    const tuple = options[i];
    if (!Array.isArray(tuple)) {
      foundError = true;
      console.error(
          'Invalid option[' + i + ']: Each FieldDropdown option must be an ' +
              'array. Found: ',
          tuple);
    } else if (typeof tuple[1] !== 'string') {
      foundError = true;
      console.error(
          'Invalid option[' + i + ']: Each FieldDropdown option id must be ' +
              'a string. Found ' + tuple[1] + ' in: ',
          tuple);
    } else if (
        tuple[0] && typeof tuple[0] !== 'string' &&
        typeof tuple[0].src !== 'string') {
      foundError = true;
      console.error(
          'Invalid option[' + i + ']: Each FieldDropdown option must have a ' +
              'string label or image description. Found' + tuple[0] + ' in: ',
          tuple);
    }
  }
  if (foundError) {
    throw TypeError('Found invalid FieldDropdown options.');
  }
}

fieldRegistry.register('field_dropdown', FieldDropdown);
