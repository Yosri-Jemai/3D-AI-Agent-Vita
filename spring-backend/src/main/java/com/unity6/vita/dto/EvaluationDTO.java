package com.unity6.vita.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

@Data
@AllArgsConstructor
@NoArgsConstructor
@Builder
public class EvaluationDTO {
    private Long id;
    private Long profileId;
    private String profileName;
    private Float score;
    private String feedback;
    private LocalDateTime date;
}