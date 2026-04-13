package com.unity6.vita.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@AllArgsConstructor
@NoArgsConstructor
@Builder
public class ReponseDTO {
    private Long id;
    private Long profileId;
    private Long evaluationId;
    private String reponse;
    private Boolean correcte;
}