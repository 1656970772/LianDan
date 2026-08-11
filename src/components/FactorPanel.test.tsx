import { fireEvent, render, screen } from "@testing-library/react";
import { alchemyConfig, defaultFactors } from "../domain";
import type { AlchemyConfig } from "../domain/types";
import { FactorPanel } from "./FactorPanel";

describe("FactorPanel", () => {
  it("无需组件分支即可渲染配置新增的普通因素", () => {
    const config: AlchemyConfig = {
      ...alchemyConfig,
      factorGroups: [
        ...alchemyConfig.factorGroups,
        { id: "group_test", name: "试验因素", description: "用于验证动态控件。", order: 99 },
      ],
      factors: [
        ...alchemyConfig.factors,
        {
          id: "test_pressure",
          label: "试验灵压",
          groupId: "group_test",
          valueType: "number",
          controlType: "range",
          defaultValue: 4,
          min: 0,
          max: 10,
          step: 1,
          unit: "级",
          description: "只用于验证因素元数据渲染。",
        },
      ],
    };
    const onChange = vi.fn();

    render(
      <FactorPanel
        config={config}
        factors={{ ...defaultFactors(config), test_pressure: 4 }}
        errors={{}}
        validationSummary={undefined}
        onChange={onChange}
        onRun={vi.fn()}
      />,
    );

    expect(screen.getAllByText("试验因素")).toHaveLength(2);
    fireEvent.change(screen.getByRole("spinbutton", { name: "试验灵压精确数值" }), {
      target: { value: "7" },
    });
    expect(onChange).toHaveBeenCalledWith("test_pressure", 7);
  });
});
