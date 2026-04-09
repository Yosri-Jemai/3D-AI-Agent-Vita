package com.unity6.vita.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.util.List;
import java.util.Map;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ExtractionResultDTO {
    private List<String> products;
    private List<Map<String, Object>> objections;
    private Integer engagementScore;
    private List<String> topics;
    private String language;
    private List<String> recommendations;
    private Map<String, Object> metadata;
}